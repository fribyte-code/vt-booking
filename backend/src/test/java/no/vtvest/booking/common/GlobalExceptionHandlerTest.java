package no.vtvest.booking.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ProblemDetail;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void aUniqueViolationFromAConcurrentDuplicateIsAConflict() {
        ProblemDetail problem = handler.handleIntegrityViolation(
                new DataIntegrityViolationException("duplikat", new SQLException("duplicate key", "23505")));
        assertThat(problem.getStatus()).isEqualTo(409);
        assertThat(problem.getProperties()).containsEntry("code", "CONFLICT");
    }

    @Test
    void otherIntegrityViolationsAreNotHandled() {
        DataIntegrityViolationException e =
                new DataIntegrityViolationException("check", new SQLException("check violation", "23514"));
        assertThatThrownBy(() -> handler.handleIntegrityViolation(e)).isSameAs(e);
    }

    @Test
    void extraPropertiesAreAddedToTheProblem() {
        ProblemDetail problem = handler.handleApi(
                new ApiException(ErrorCode.CONFLICT, "Opptatt.", java.util.Map.of("conflicts", java.util.List.of())));
        assertThat(problem.getProperties()).containsEntry("conflicts", java.util.List.of()).containsEntry("code", "CONFLICT");
    }

    @Test
    void deadlocksAndSerializationFailuresAskTheClientToRetry() {
        for (var e : java.util.List.of(
                new org.springframework.dao.CannotAcquireLockException("deadlock", new SQLException("deadlock detected", "40P01")),
                new org.springframework.dao.PessimisticLockingFailureException("lås"),
                new org.springframework.orm.jpa.JpaSystemException(new RuntimeException(new SQLException("could not serialize", "40001"))))) {
            ProblemDetail problem = handler.handleDataAccess(e);
            assertThat(problem.getStatus()).isEqualTo(409);
            assertThat(problem.getProperties()).containsEntry("code", "VERSION_CONFLICT");
        }
    }

    @Test
    void otherDataAccessErrorsAreNotHandled() {
        var e = new org.springframework.dao.DataAccessResourceFailureException("nede", new SQLException("connection", "08006"));
        assertThatThrownBy(() -> handler.handleDataAccess(e)).isSameAs(e);
    }
}
