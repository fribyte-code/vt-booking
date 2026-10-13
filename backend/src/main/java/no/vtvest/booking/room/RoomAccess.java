package no.vtvest.booking.room;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

/** Per-organization override of a room's default permission. */
@Entity
@Table(name = "room_access")
public class RoomAccess {

    @EmbeddedId
    private RoomAccessId id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Permission permission;

    protected RoomAccess() {}

    public RoomAccessId getId() {
        return id;
    }

    public Permission getPermission() {
        return permission;
    }
}
