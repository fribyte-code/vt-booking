package no.vtvest.booking.booking;

import java.util.Set;
import java.util.UUID;
import no.vtvest.booking.user.User;

/**
 * Who is looking, with what they may see and decide: their organizations and the rooms they
 * manage (see RoomManagement) and the rooms hidden from them (see RoomVisibility), all read from
 * the database for this request. System admins see and decide everything.
 */
record Viewer(User user, Set<UUID> organizationIds, Set<UUID> managedRoomIds, Set<UUID> hiddenRoomIds) {

    boolean isSystemAdmin() {
        return user.isSystemAdmin();
    }

    /**
     * Everyone sees approved bookings, except in rooms hidden from them; other statuses only their
     * own organization, the room's managers and system admins. An organization always sees its own
     * bookings, also in a room that has since been hidden from it.
     */
    boolean sees(Booking booking) {
        return (booking.getStatus() == BookingStatus.APPROVED && !hiddenRoomIds.contains(booking.getRoomId()))
                || seesDetails(booking);
    }

    /** Description, comments and the people involved. */
    boolean seesDetails(Booking booking) {
        return ownOrganization(booking) || managedRoomIds.contains(booking.getRoomId());
    }

    boolean ownOrganization(Booking booking) {
        return user.isSystemAdmin() || organizationIds.contains(booking.getOrganizationId());
    }

    /** May approve and reject requests in the room. */
    boolean mayDecide(UUID roomId) {
        return user.isSystemAdmin() || managedRoomIds.contains(roomId);
    }

    boolean mayDecideAny() {
        return user.isSystemAdmin() || !managedRoomIds.isEmpty();
    }
}
