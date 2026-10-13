package no.vtvest.booking.booking;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "bookings")
public class Booking {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(name = "requested_by_id", nullable = false)
    private UUID requestedById;

    @Column(nullable = false)
    private String title;

    private String description;

    @Column(name = "start_at", nullable = false)
    private Instant startAt;

    @Column(name = "end_at", nullable = false)
    private Instant endAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BookingStatus status;

    @Column(name = "requires_approval", nullable = false)
    private boolean requiresApproval;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decided_by_id")
    private UUID decidedById;

    @Column(name = "decision_comment")
    private String decisionComment;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "cancelled_by_id")
    private UUID cancelledById;

    @Column(name = "cancellation_reason")
    private String cancellationReason;

    @Version
    private int version;

    protected Booking() {}

    Booking(
            UUID roomId,
            UUID organizationId,
            UUID requestedById,
            String title,
            String description,
            Instant startAt,
            Instant endAt,
            boolean requiresApproval,
            Instant createdAt) {
        this.roomId = roomId;
        this.organizationId = organizationId;
        this.requestedById = requestedById;
        this.title = title;
        this.description = description;
        this.startAt = startAt;
        this.endAt = endAt;
        this.requiresApproval = requiresApproval;
        this.status = requiresApproval ? BookingStatus.PENDING : BookingStatus.APPROVED;
        this.createdAt = createdAt;
    }

    void approve(UUID adminId, Instant now, String comment) {
        this.status = BookingStatus.APPROVED;
        recordDecision(adminId, now, comment);
    }

    void reject(UUID adminId, Instant now, String reason) {
        this.status = BookingStatus.REJECTED;
        recordDecision(adminId, now, reason);
    }

    void cancel(UUID userId, Instant now, String reason) {
        this.status = BookingStatus.CANCELLED;
        this.cancelledById = userId;
        this.cancelledAt = now;
        this.cancellationReason = reason;
    }

    private void recordDecision(UUID adminId, Instant now, String comment) {
        this.decidedById = adminId;
        this.decidedAt = now;
        this.decisionComment = comment;
    }

    public UUID getId() {
        return id;
    }

    public UUID getRoomId() {
        return roomId;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getRequestedById() {
        return requestedById;
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public Instant getStartAt() {
        return startAt;
    }

    public Instant getEndAt() {
        return endAt;
    }

    public BookingStatus getStatus() {
        return status;
    }

    public boolean isRequiresApproval() {
        return requiresApproval;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getDecidedAt() {
        return decidedAt;
    }

    public UUID getDecidedById() {
        return decidedById;
    }

    public String getDecisionComment() {
        return decisionComment;
    }

    public Instant getCancelledAt() {
        return cancelledAt;
    }

    public UUID getCancelledById() {
        return cancelledById;
    }

    public String getCancellationReason() {
        return cancellationReason;
    }

    public int getVersion() {
        return version;
    }
}
