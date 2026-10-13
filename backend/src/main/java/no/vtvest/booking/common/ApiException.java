package no.vtvest.booking.common;

/** A domain error with a stable code and a Norwegian message that is safe to show to users. */
public class ApiException extends RuntimeException {

    private final ErrorCode code;

    public ApiException(ErrorCode code, String message) {
        super(message);
        this.code = code;
    }

    public ErrorCode code() {
        return code;
    }
}
