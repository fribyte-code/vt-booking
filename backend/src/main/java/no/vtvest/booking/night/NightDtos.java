package no.vtvest.booking.night;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The night overview: coming events past midnight, and whether guards are ordered for them. */
final class NightDtos {

    private NightDtos() {}

    /** BOOKING: approved (series included); REQUEST: a pending application; PUBLIC_REQUEST: from /soknad, not booked yet. */
    enum Kind { BOOKING, REQUEST, PUBLIC_REQUEST }

    /** Someone responsible at the event; {@code phone} only for a public request's contacts. */
    record Contact(String name, String organization, String phone) {}

    record NightEvent(
            Kind kind,
            /** Null for a public request without a booking. */
            UUID bookingId,
            /** The public request the event comes from, or null. */
            UUID publicRequestId,
            UUID seriesId,
            String title,
            /** For a public request without a booking: the room asked for, or null for no preference. */
            UUID roomId,
            String roomName,
            String organizationName,
            Instant start,
            Instant end,
            List<Contact> contacts,
            Instant guardsOrderedAt,
            String guardsOrderedByName) {}

    record NightCount(long count) {}

    /** One of the ids, as on a {@link NightEvent}; a booking made from a request is marked through the request. */
    record SetGuards(UUID bookingId, UUID publicRequestId, boolean ordered) {}
}
