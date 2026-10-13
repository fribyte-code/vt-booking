package no.vtvest.booking.room;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "rooms")
public class Room {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String name;

    private String description;

    private String location;

    private Integer capacity;

    @Column(nullable = false)
    private String color;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RoomStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "default_permission", nullable = false)
    private Permission defaultPermission;

    protected Room() {}

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public String getLocation() {
        return location;
    }

    public Integer getCapacity() {
        return capacity;
    }

    public String getColor() {
        return color;
    }

    public RoomStatus getStatus() {
        return status;
    }

    public Permission getDefaultPermission() {
        return defaultPermission;
    }
}
