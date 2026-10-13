package no.vtvest.booking.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Development-only login: every user in the database can log in with one shared password.
 * Disabled by default; enabled by the "dev" profile. Replaced by Feide/Google OIDC later.
 */
@ConfigurationProperties("app.dev-auth")
public record DevAuthProperties(boolean enabled, String password) {}
