package no.vtvest.booking.room;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.UUID;

@Embeddable
public record RoomAccessId(
        @Column(name = "room_id") UUID roomId,
        @Column(name = "organization_id") UUID organizationId) implements Serializable {}
