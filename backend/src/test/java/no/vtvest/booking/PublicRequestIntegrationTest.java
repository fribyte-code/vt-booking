package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** The public request form (/soknad) and how a system admin handles the requests. */
class PublicRequestIntegrationTest extends IntegrationTest {

    private static final java.time.ZoneId OSLO_ZONE = java.time.ZoneId.of("Europe/Oslo");

    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");

    private static final String CONTACT =
            "{\"name\":\" Kari Nordmann \",\"organization\":\"Ekstern forening\",\"cardNumber\":\"1234 5678\",\"phone\":\"+47 912 34 567\"}";

    /** Storsalen is offered in the form (see setUp). */
    private static String requestJson(Instant start, Instant end) {
        return requestJson(start, end, "\"" + STORSALEN + "\"", "[" + CONTACT + "]");
    }

    private static String requestJson(Instant start, Instant end, String roomId, String contacts) {
        return """
                {"email":" Leder@Example.TEST ","organizationName":"Ekstern forening","eventName":" Hagekonsert ","memberOfKulturstyretOrSamfunnet":true,
                 "preferredRoomId":%s,"start":"%s","end":"%s","description":"Konsert i hagen","contacts":%s}
                """.formatted(roomId, start, end, contacts);
    }

    @BeforeEach
    void offerStorsalen() {
        jdbc.update("UPDATE rooms SET public_requestable = true WHERE id = ?", STORSALEN);
    }

    /** Without logging in, exactly like the public form. */
    private ResultActions submitAnonymously(String json) throws Exception {
        return mvc.perform(post("/api/public/requests").with(withCsrf())
                .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private UUID submit(Instant start, Instant end) throws Exception {
        submitAnonymously(requestJson(start, end)).andExpect(status().isNoContent());
        return jdbc.queryForObject("SELECT id FROM public_requests ORDER BY created_at DESC LIMIT 1", UUID.class);
    }

    private String requestStatus(UUID id) {
        return jdbc.queryForObject("SELECT status FROM public_requests WHERE id = ?", String.class, id);
    }

    @Test
    void anyoneCanSubmitWithoutLoggingInButNotWithoutCsrf() throws Exception {
        UUID id = submit(at(7, 18), at(8, 0));

        assertThat(jdbc.queryForMap("SELECT * FROM public_requests WHERE id = ?", id))
                .containsEntry("email", "leder@example.test")
                .containsEntry("organization_name", "Ekstern forening")
                .containsEntry("event_name", "Hagekonsert")
                .containsEntry("member_of_kulturstyret_or_samfunnet", true)
                .containsEntry("preferred_room_id", STORSALEN)
                .containsEntry("preferred_room_name", "Storsalen")
                .containsEntry("status", "NEW");
        // Spaces and hyphens are removed from the card number and phone.
        assertThat(jdbc.queryForMap("SELECT * FROM public_request_contacts WHERE request_id = ?", id))
                .containsEntry("position", 0)
                .containsEntry("name", "Kari Nordmann")
                .containsEntry("organization", "Ekstern forening")
                .containsEntry("card_number", "12345678")
                .containsEntry("phone", "+4791234567");

        mvc.perform(post("/api/public/requests").contentType(MediaType.APPLICATION_JSON).content(requestJson(at(7, 18), at(7, 20))))
                .andExpect(status().isForbidden());
    }

    @Test
    void invalidRequestsAreRefused() throws Exception {
        submitAnonymously(requestJson(at(7, 20), at(7, 18))).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(-1, 18), at(-1, 20))).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 0), at(8, 2))).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace("Leder@Example.TEST", "ikke-epost"))
                .andExpect(status().isBadRequest());
        // Longer than 22 hours (07:00–05:00 is the longest the closed hours leave).
        submitAnonymously(requestJson(at(7, 0), at(7, 23).plusSeconds(3600))).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace(" Hagekonsert ", " ")).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace(" Hagekonsert ", "x".repeat(81))).andExpect(status().isBadRequest());
        // Only rooms offered in the form; unknown, unoffered and closed rooms are refused.
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "\"" + ROOM_A + "\"", "[" + CONTACT + "]"))
                .andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "\"" + java.util.UUID.randomUUID() + "\"", "[" + CONTACT + "]"))
                .andExpect(status().isBadRequest());
        jdbc.update("UPDATE rooms SET status = 'DISABLED' WHERE id = ?", STORSALEN);
        submitAnonymously(requestJson(at(7, 18), at(7, 20))).andExpect(status().isBadRequest());
        jdbc.update("UPDATE rooms SET status = 'ACTIVE' WHERE id = ?", STORSALEN);
        // 1–10 contacts, each complete, with a card number of digits and a phone number.
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "null", "[]")).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "null", "[" + String.join(",", java.util.Collections.nCopies(11, CONTACT)) + "]"))
                .andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "null", "[" + CONTACT.replace("1234 5678", "s123456") + "]"))
                .andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "null", "[" + CONTACT.replace("+47 912 34 567", "112") + "]"))
                .andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "null", "[" + CONTACT.replace(" Kari Nordmann ", " ") + "]"))
                .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public_requests", Integer.class)).isZero();
    }

    @Test
    void requestsAtMost180DaysAhead() throws Exception {
        submitAnonymously(requestJson(at(179, 18), at(179, 20))).andExpect(status().isNoContent());
        submitAnonymously(requestJson(at(181, 18), at(181, 20)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        // Beyond what PostgreSQL can store: refused before it gets there (it used to give 500).
        Instant farFuture = Instant.parse("+300000-01-01T18:00:00Z");
        submitAnonymously(requestJson(farFuture, farFuture.plusSeconds(7200)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public_requests", Integer.class)).isOne();
    }

    @Test
    void theCountIsTheUnhandledRequestsForSystemAdminsOnly() throws Exception {
        call(get("/api/admin/public-requests/count"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(0));
        UUID rejected = submit(at(7, 18), at(7, 20));
        submit(at(8, 18), at(8, 20));
        submit(at(9, 18), at(9, 20));
        call(post("/api/admin/public-requests/" + rejected + "/reject"), ADMIN, null).andExpect(status().isOk());

        call(get("/api/admin/public-requests/count"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(2));
        mvc.perform(get("/api/admin/public-requests/count")).andExpect(status().isUnauthorized());
        call(get("/api/admin/public-requests/count"), KARI, null).andExpect(status().isForbidden());
    }

    @Test
    void onlySystemAdminsCanReadAndHandleRequests() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        mvc.perform(get("/api/admin/public-requests")).andExpect(status().isUnauthorized());
        call(get("/api/admin/public-requests"), KARI, null).andExpect(status().isForbidden());
        call(post("/api/admin/public-requests/" + id + "/reject"), KARI, null).andExpect(status().isForbidden());
        call(post("/api/admin/public-requests/" + id + "/booking"), KARI,
                bookingJson(ROOM_A, ORG_A, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isForbidden());
        assertThat(requestStatus(id)).isEqualTo("NEW");

        call(get("/api/admin/public-requests"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(id.toString()))
                .andExpect(jsonPath("$[0].description").value("Konsert i hagen"))
                .andExpect(jsonPath("$[0].organizationName").value("Ekstern forening"))
                .andExpect(jsonPath("$[0].eventName").value("Hagekonsert"))
                .andExpect(jsonPath("$[0].preferredRoomId").value(STORSALEN.toString()))
                .andExpect(jsonPath("$[0].preferredRoomName").value("Storsalen"))
                .andExpect(jsonPath("$[0].contacts[0].cardNumber").value("12345678"))
                .andExpect(jsonPath("$[0].status").value("NEW"));
    }

    @Test
    void rejectingMarksTheRequestOnce() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        call(post("/api/admin/public-requests/" + id + "/reject"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"));
        call(post("/api/admin/public-requests/" + id + "/reject"), ADMIN, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_B, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isConflict());
    }

    @Test
    void noPreferenceAndSeveralContactsAreFine() throws Exception {
        String second = CONTACT.replace(" Kari Nordmann ", "Ola Nordmann").replace("1234 5678", "87654321");
        submitAnonymously(requestJson(at(7, 18), at(7, 20), "null", "[" + CONTACT + "," + second + "]"))
                .andExpect(status().isNoContent());
        call(get("/api/admin/public-requests"), ADMIN, null)
                .andExpect(jsonPath("$[0].preferredRoomId").doesNotExist())
                .andExpect(jsonPath("$[0].preferredRoomName").doesNotExist())
                .andExpect(jsonPath("$[0].contacts.length()").value(2))
                .andExpect(jsonPath("$[0].contacts[1].name").value("Ola Nordmann"));
    }

    @Test
    void aDeletedRoomKeepsItsNameOnTheRequest() throws Exception {
        submit(at(7, 18), at(7, 20));
        jdbc.update("UPDATE rooms SET status = 'ARCHIVED' WHERE id = ?", STORSALEN);
        call(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/admin/rooms/" + STORSALEN), ADMIN, null)
                .andExpect(status().isNoContent());
        call(get("/api/admin/public-requests"), ADMIN, null)
                .andExpect(jsonPath("$[0].preferredRoomId").doesNotExist())
                .andExpect(jsonPath("$[0].preferredRoomName").value("Storsalen"));
    }

    @Test
    void theFormListsOnlyOfferedActiveRoomsWithTheirOpeningHours() throws Exception {
        jdbc.update("INSERT INTO room_opening_hours (room_id, day_of_week, opens_minute, closes_minute) VALUES (?, 6, 480, 960)", STORSALEN);
        jdbc.update("UPDATE rooms SET public_requestable = true, status = 'DISABLED' WHERE id = ?", ROOM_B);

        mvc.perform(get("/api/public/rooms"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(STORSALEN.toString()))
                .andExpect(jsonPath("$[0].name").value("Storsalen"))
                .andExpect(jsonPath("$[0].openingHours[0].day").value("SATURDAY"))
                .andExpect(jsonPath("$[0].openingHours[0].opens").value("08:00"))
                .andExpect(jsonPath("$[0].openingHours[0].closes").value("16:00"))
                .andExpect(jsonPath("$[0].defaultPermission").doesNotExist());
    }

    @Test
    void aRequestForARoomMustBeWithinItsOpeningHours() throws Exception {
        // Storsalen open only Saturdays 08:00–16:00.
        jdbc.update("INSERT INTO room_opening_hours (room_id, day_of_week, opens_minute, closes_minute) VALUES (?, 6, 480, 960)", STORSALEN);
        java.time.LocalDate saturday = java.time.LocalDate.now(OSLO_ZONE).plusDays(7).with(java.time.temporal.TemporalAdjusters.next(java.time.DayOfWeek.SATURDAY));
        Instant ten = saturday.atTime(10, 0).atZone(OSLO_ZONE).toInstant();
        submitAnonymously(requestJson(ten, ten.plusSeconds(4 * 3600))).andExpect(status().isNoContent());
        submitAnonymously(requestJson(ten, ten.plusSeconds(8 * 3600)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.detail").value("Storsalen er bare åpent lør 08:00–16:00."));
        // Without a preference, the hours don't apply to the request; the admin picks a room.
        submitAnonymously(requestJson(ten, ten.plusSeconds(8 * 3600), "null", "[" + CONTACT + "]")).andExpect(status().isNoContent());
    }

    @Test
    void theClosedHoursApplyToRequestsAndToTheAdminsBooking() throws Exception {
        submitAnonymously(requestJson(oslo(7, 22, 0), oslo(8, 6, 0)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("RULE_VIOLATION"));

        UUID id = submit(oslo(7, 22, 0), oslo(8, 5, 0));
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                        bookingJson(ROOM_A, ORG_B, "Konsert", oslo(7, 22, 0), oslo(8, 5, 30)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("RULE_VIOLATION"));
        assertThat(requestStatus(id)).isEqualTo("NEW");
    }

    @Test
    void adminBooksOvernightForAnOrganizationTheyAreNotMemberOfAndTheRequestIsLinked() throws Exception {
        UUID id = submit(at(7, 20), at(8, 2));

        // The admin has no memberships; the booking follows Organisasjon B's DIRECT access to room A.
        String body = call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                        bookingJson(ROOM_A, ORG_B, "Konsert", at(7, 20), at(8, 2)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.organizationId").value(ORG_B.toString()))
                .andReturn().getResponse().getContentAsString();
        String bookingId = com.jayway.jsonpath.JsonPath.read(body, "$.id");

        assertThat(requestStatus(id)).isEqualTo("DONE");
        assertThat(jdbc.queryForObject("SELECT booking_id FROM public_requests WHERE id = ?", UUID.class, id))
                .isEqualTo(UUID.fromString(bookingId));

        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_B, "Konsert", at(9, 20), at(9, 22)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
    }

    @Test
    void adminCanTransferToAnOrganizationWithoutAccessWhileUsersStillCannotBookIt() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        // Organisasjon C has no access to room A: Ingrid (member of C) can't book it herself.
        call(post("/api/bookings"), "20000000-0000-0000-0000-000000000003",
                bookingJson(ROOM_A, ORG_C, "Selv", at(7, 18), at(7, 20)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));

        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_C, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.organizationId").value(ORG_C.toString()));
        assertThat(requestStatus(id)).isEqualTo("DONE");

        // No access was granted, and the booking still blocks the slot.
        assertThat(jdbc.queryForObject("SELECT permission FROM room_access WHERE room_id = ? AND organization_id = ?",
                String.class, ROOM_A, ORG_C)).isEqualTo("NONE");
        call(post("/api/bookings"), KARI, bookingJson(ROOM_A, ORG_A, "Kolliderer", at(7, 19), at(7, 21)))
                .andExpect(status().isConflict());
        // An organization admin is no exception either: Jonas is ORG_ADMIN of A and member of C.
        call(post("/api/bookings"), JONAS, bookingJson(ROOM_A, ORG_C, "Selv", at(9, 18), at(9, 20)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));
    }

    @Test
    void aTransferIsApprovedEvenWhereTheOrganizationMustApplyWhileItsOwnBookingsStillNeedApproval() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        // Organisasjon A has REQUEST access to room B: Kari's own booking is a pending request.
        call(post("/api/bookings"), KARI, bookingJson(ROOM_B, ORG_A, "Selv", at(9, 18), at(9, 20)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"));

        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_B, ORG_A, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.requiresApproval").value(false));
        assertThat(requestStatus(id)).isEqualTo("DONE");
        assertThat(jdbc.queryForObject("SELECT permission FROM room_access WHERE room_id = ? AND organization_id = ?",
                String.class, ROOM_B, ORG_A)).isEqualTo("REQUEST");
    }

    @Test
    void aRefusedBookingLeavesTheRequestNew() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));
        createBooking(KARI, ROOM_A, ORG_A, at(7, 18), at(7, 20));

        // Double booking.
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_B, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"));
        // A closed room can't be booked, not even on behalf.
        jdbc.update("UPDATE rooms SET status = 'DISABLED' WHERE id = ?", ROOM_B);
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_B, ORG_A, "Konsert", at(7, 20), at(7, 22)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));

        assertThat(requestStatus(id)).isEqualTo("NEW");
        assertThat(jdbc.queryForObject("SELECT booking_id FROM public_requests WHERE id = ?", UUID.class, id)).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM bookings", Integer.class)).isEqualTo(1);
    }

    // ── Handling status and edits ───────────────────────────────────

    private static String statusJson(String status) {
        return "{\"status\":\"" + status + "\"}";
    }

    @Test
    void adminsSetTheHandlingStatusAndOnlyNewOnesCountAsUnhandled() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));
        submit(at(8, 18), at(8, 20));

        call(put("/api/admin/public-requests/" + id + "/status"), ADMIN, statusJson("IN_PROGRESS"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.updatedByName").value("Silje Aas"))
                .andExpect(jsonPath("$.updatedAt").isString());
        call(get("/api/admin/public-requests/count"), ADMIN, null).andExpect(jsonPath("$.count").value(1));

        // In progress can still be booked; the booking marks it done.
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN, bookingJson(STORSALEN, ORG_B, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isCreated());
        assertThat(requestStatus(id)).isEqualTo("DONE");

        // Reopened, it keeps its booking and can't get another.
        call(put("/api/admin/public-requests/" + id + "/status"), ADMIN, statusJson("IN_PROGRESS")).andExpect(status().isOk());
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN, bookingJson(STORSALEN, ORG_B, "Igjen", at(9, 18), at(9, 20)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        // But it can be rejected, or marked done by hand.
        call(post("/api/admin/public-requests/" + id + "/reject"), ADMIN, null).andExpect(jsonPath("$.status").value("REJECTED"));
        call(put("/api/admin/public-requests/" + id + "/status"), ADMIN, statusJson("DONE")).andExpect(jsonPath("$.status").value("DONE"));

        call(put("/api/admin/public-requests/" + id + "/status"), ADMIN, statusJson("TRANSFERRED")).andExpect(status().isBadRequest());
        call(put("/api/admin/public-requests/" + id + "/status"), KARI, statusJson("NEW")).andExpect(status().isForbidden());
        call(put("/api/admin/public-requests/" + UUID.randomUUID() + "/status"), ADMIN, statusJson("NEW")).andExpect(status().isNotFound());
    }

    private static String editJson(Instant start, Instant end, String roomId, String contacts) {
        return """
                {"email":"Ny@Example.TEST","organizationName":"Ny forening","eventName":"Vinterkonsert","memberOfKulturstyretOrSamfunnet":false,
                 "preferredRoomId":%s,"start":"%s","end":"%s","description":"Endret","contacts":%s}
                """.formatted(roomId, start, end, contacts);
    }

    @Test
    void adminsEditARequestAtAnyStatus() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));
        call(post("/api/admin/public-requests/" + id + "/reject"), ADMIN, null).andExpect(status().isOk());
        String second = CONTACT.replace(" Kari Nordmann ", "Ola").replace("1234 5678", "87654321");

        // Any room that isn't archived, also one not offered in the form.
        call(put("/api/admin/public-requests/" + id), ADMIN, editJson(at(8, 18), at(8, 21), "\"" + ROOM_A + "\"", "[" + CONTACT + "," + second + "]"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("ny@example.test"))
                .andExpect(jsonPath("$.eventName").value("Vinterkonsert"))
                .andExpect(jsonPath("$.preferredRoomId").value(ROOM_A.toString()))
                .andExpect(jsonPath("$.preferredRoomName").value("Møterom A"))
                .andExpect(jsonPath("$.contacts.length()").value(2))
                .andExpect(jsonPath("$.contacts[1].name").value("Ola"))
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.updatedByName").value("Silje Aas"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public_request_contacts WHERE request_id = ?", Integer.class, id)).isEqualTo(2);

        // A time that has passed is fine for an edit (the request may be old); the time rules aren't.
        call(put("/api/admin/public-requests/" + id), ADMIN, editJson(at(-3, 18), at(-3, 20), "null", "[" + CONTACT + "]"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.preferredRoomId").doesNotExist());
        call(put("/api/admin/public-requests/" + id), ADMIN, editJson(oslo(8, 22, 0), oslo(9, 6, 0), "null", "[" + CONTACT + "]"))
                .andExpect(status().isUnprocessableContent());
        call(put("/api/admin/public-requests/" + id), ADMIN, editJson(at(8, 18), at(8, 20), "null", "[]"))
                .andExpect(status().isBadRequest());
        call(put("/api/admin/public-requests/" + id), ADMIN, editJson(at(8, 18), at(8, 20), "null", "[" + CONTACT.replace("1234 5678", "s1") + "]"))
                .andExpect(status().isBadRequest());
        jdbc.update("UPDATE rooms SET status = 'ARCHIVED' WHERE id = ?", ROOM_B);
        call(put("/api/admin/public-requests/" + id), ADMIN, editJson(at(8, 18), at(8, 20), "\"" + ROOM_B + "\"", "[" + CONTACT + "]"))
                .andExpect(status().isBadRequest());

        call(put("/api/admin/public-requests/" + id), KARI, editJson(at(8, 18), at(8, 20), "null", "[" + CONTACT + "]"))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/admin/public-requests/" + id).with(withCsrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(editJson(at(8, 18), at(8, 20), "null", "[" + CONTACT + "]")))
                .andExpect(status().isUnauthorized());
    }
}
