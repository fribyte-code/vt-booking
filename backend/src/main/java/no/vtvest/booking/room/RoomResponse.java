package no.vtvest.booking.room;

import java.util.List;
import java.util.UUID;

public record RoomResponse(
        UUID id,
        String name,
        String description,
        String location,
        Integer capacity,
        String color,
        RoomStatus status,
        /** Its ORG_ADMINs approve the room's requests; null: system admins only (VT). */
        UUID managingOrganizationId,
        /** The current user's booking right per organization they belong to. */
        List<OrganizationPermission> permissions,
        /** Empty: open around the clock (apart from 05:00–07:00). */
        List<OpeningHours.Entry> openingHours) {

    public record OrganizationPermission(UUID organizationId, Permission permission) {}

    static RoomResponse from(Room room, List<OrganizationPermission> permissions, List<OpeningHours.Interval> hours) {
        return new RoomResponse(
                room.getId(),
                room.getName(),
                room.getDescription(),
                room.getLocation(),
                room.getCapacity(),
                room.getColor(),
                room.getStatus(),
                room.getManagingOrganizationId(),
                permissions,
                OpeningHours.toEntries(hours));
    }
}
