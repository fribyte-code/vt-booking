package no.vtvest.booking.room;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import no.vtvest.booking.organization.Membership;
import no.vtvest.booking.organization.MembershipId;
import no.vtvest.booking.organization.MembershipRepository;
import no.vtvest.booking.organization.Organization;
import no.vtvest.booking.organization.OrganizationRepository;
import no.vtvest.booking.user.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RoomService {

    private final RoomRepository rooms;
    private final RoomAccessRepository roomAccess;
    private final MembershipRepository memberships;
    private final OrganizationRepository organizations;

    RoomService(
            RoomRepository rooms,
            RoomAccessRepository roomAccess,
            MembershipRepository memberships,
            OrganizationRepository organizations) {
        this.rooms = rooms;
        this.roomAccess = roomAccess;
        this.memberships = memberships;
        this.organizations = organizations;
    }

    /**
     * The single place that decides an organization's booking right for a room:
     * the per-organization override if present, otherwise the room's default.
     * Inactive rooms and organizations can never be booked.
     */
    public Permission effectivePermission(Room room, Organization organization) {
        RoomAccess override = roomAccess.findById(new RoomAccessId(room.getId(), organization.getId())).orElse(null);
        return resolve(room, organization, override == null ? null : override.getPermission());
    }

    /**
     * Non-archived rooms, each with the effective permission per organization the actor belongs to.
     * Administrators get the permission of every active organization (the admin overview).
     */
    @Transactional(readOnly = true)
    public List<RoomResponse> listRooms(User actor) {
        List<Organization> myOrganizations = actor.isSystemAdmin()
                ? organizations.findAll().stream().filter(Organization::isActive).toList()
                : organizations.findAllById(memberships.findByIdUserId(actor.getId()).stream()
                        .map(Membership::getId)
                        .map(MembershipId::organizationId)
                        .toList());
        Map<RoomAccessId, Permission> overrides = roomAccess
                .findByIdOrganizationIdIn(myOrganizations.stream().map(Organization::getId).toList())
                .stream()
                .collect(Collectors.toMap(RoomAccess::getId, RoomAccess::getPermission));

        return rooms.findByStatusNotOrderByName(RoomStatus.ARCHIVED).stream()
                .map(room -> RoomResponse.from(room, myOrganizations.stream()
                        .map(org -> new RoomResponse.OrganizationPermission(
                                org.getId(),
                                resolve(room, org, overrides.get(new RoomAccessId(room.getId(), org.getId())))))
                        .toList()))
                .toList();
    }

    private static Permission resolve(Room room, Organization organization, Permission override) {
        if (room.getStatus() != RoomStatus.ACTIVE || !organization.isActive()) {
            return Permission.NONE;
        }
        return override != null ? override : room.getDefaultPermission();
    }
}
