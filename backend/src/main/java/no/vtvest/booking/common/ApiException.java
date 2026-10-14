package no.vtvest.booking.common;

import java.util.Map;

/** A domain error with a stable code and a Norwegian message that is safe to show to users. */
public class ApiException extends RuntimeException {

    private final ErrorCode code;
    private final Map<String, Object> properties;

    public ApiException(ErrorCode code, String message) {
        this(code, message, Map.of());
    }

    /** {@code properties} are added to the Problem Details next to {@code code}, e.g. the conflicting times. */
    public ApiException(ErrorCode code, String message, Map<String, Object> properties) {
        super(message);
        this.code = code;
        this.properties = Map.copyOf(properties);
    }

    public ErrorCode code() {
        return code;
    }

    public Map<String, Object> properties() {
        return properties;
    }
}
