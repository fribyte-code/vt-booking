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
        /** The current user's booking right per organization they belong to. */
        List<OrganizationPermission> permissions) {

    public record OrganizationPermission(UUID organizationId, Permission permission) {}

    static RoomResponse from(Room room, List<OrganizationPermission> permissions) {
        return new RoomResponse(
                room.getId(),
                room.getName(),
                room.getDescription(),
                room.getLocation(),
                room.getCapacity(),
                room.getColor(),
                room.getStatus(),
                permissions);
    }
}
