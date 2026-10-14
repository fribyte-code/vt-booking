package no.vtvest.booking.common;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** Maps errors to RFC 9457 Problem Details with a stable {@code code} property. */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final String UNIQUE_VIOLATION = "23505";
    /** PostgreSQL deadlock_detected and serialization_failure: the transaction lost a race and was rolled back. */
    private static final Set<String> RETRYABLE = Set.of("40P01", "40001");

    @ExceptionHandler(ApiException.class)
    ProblemDetail handleApi(ApiException e) {
        ProblemDetail problem = problem(e.code(), e.getMessage());
        e.properties().forEach(problem::setProperty);
        return problem;
    }

    /**
     * A unique constraint stopped a concurrent duplicate, e.g. two admins adding the same member at
     * once: the services' own checks can't see the other transaction's row. Other integrity
     * violations are bugs, so they are rethrown and stay a 500.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail handleIntegrityViolation(DataIntegrityViolationException e) {
        if (hasSqlState(e, Set.of(UNIQUE_VIOLATION))) {
            return problem(ErrorCode.CONFLICT, "Dette finnes allerede. Last inn på nytt og prøv igjen.");
        }
        throw e;
    }

    /** A concurrent update won the race; the client must reload and try again. */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    ProblemDetail handleOptimisticLock(OptimisticLockingFailureException e) {
        return problem(ErrorCode.VERSION_CONFLICT, "Bookingen er endret av noen andre. Last inn på nytt og prøv igjen.");
    }

    /**
     * PostgreSQL broke a deadlock or a serialization conflict by rolling this transaction back.
     * Writes lock in a fixed order to avoid this, but if it happens, the client can simply retry.
     * Spring usually translates it to a {@link PessimisticLockingFailureException}; through JPA it
     * can also arrive as another {@link DataAccessException} carrying the SQLState. Anything else
     * is rethrown and stays a 500.
     */
    @ExceptionHandler(DataAccessException.class)
    ProblemDetail handleDataAccess(DataAccessException e) {
        if (e instanceof PessimisticLockingFailureException || hasSqlState(e, RETRYABLE)) {
            return problem(ErrorCode.VERSION_CONFLICT, "Noen andre endret de samme dataene samtidig. Prøv igjen.");
        }
        throw e;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail handleInvalidBody(MethodArgumentNotValidException e) {
        ProblemDetail problem = problem(ErrorCode.VALIDATION, "Ugyldige data i forespørselen.");
        List<Map<String, String>> errors = e.getBindingResult().getFieldErrors().stream()
                .map(f -> Map.of("field", f.getField(), "message", String.valueOf(f.getDefaultMessage())))
                .toList();
        problem.setProperty("errors", errors);
        return problem;
    }

    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MethodArgumentTypeMismatchException.class,
        MissingServletRequestParameterException.class
    })
    ProblemDetail handleMalformed(Exception e) {
        return problem(ErrorCode.VALIDATION, "Ugyldig forespørsel.");
    }

    private static boolean hasSqlState(Throwable e, Set<String> states) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException sql && states.contains(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private static ProblemDetail problem(ErrorCode code, String detail) {
        HttpStatus status = code.status();
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(status.getReasonPhrase());
        problem.setProperty("code", code.name());
        return problem;
    }
}
