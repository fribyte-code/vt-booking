package no.vtvest.booking.room;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

/**
 * Written with JdbcTemplate by AdminService; JPA only reads it. Not {@code @Immutable}: booking writes
 * lock this row through JPA, and Hibernate refuses locks on read-only entities.
 */
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

    /** Whose ORG_ADMINs approve the room's requests besides system admins; null for system admins only. */
    @Column(name = "managing_organization_id")
    private UUID managingOrganizationId;

    /** Shown only to those with access, its managers and system admins (see RoomVisibility). */
    @Column(name = "hidden_without_access", nullable = false)
    private boolean hiddenWithoutAccess;

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

    public UUID getManagingOrganizationId() {
        return managingOrganizationId;
    }

    public boolean isHiddenWithoutAccess() {
        return hiddenWithoutAccess;
    }
}
