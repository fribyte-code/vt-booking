# Velferdstinget Vest – Bookingsystem

## Prosjektbeskrivelse

Utvikle et webbasert rombookingsystem for Velferdstinget Vest. Systemet skal erstatte eller supplere Google Kalender, med et lignende kalendergrensesnitt, men med tilgangsstyring og bookingregler.

## Funksjonelle krav

### Kalender og rom
- Flere rom med hver sin kalender.
- Dag-, uke- og månedsvisning.
- Samlet kalenderoversikt med filtrering på rom.
- Forhindre dobbeltbooking.
- Vise tilgjengelige og opptatte tidsrom.

### Brukere og organisasjoner
- Brukere kan tilhøre én eller flere organisasjoner.
- Organisasjoner har forskjellige rettigheter til ulike rom.
- Brukere kan booke på vegne av sin organisasjon.
- Administratorer kan administrere rom, brukere og tilganger.

### Booking
Tre tilgangsnivåer per organisasjon og rom:

| Tilgang | Beskrivelse |
|---|---|
| DIRECT | Kan booke direkte |
| REQUEST | Må sende søknad |
| NONE | Kan ikke booke |

### Søknad og godkjenning
- Enkelte bookinger krever godkjenning fra administrator.
- Søknadsskjema med tidspunkt, formål og kommentar.
- Administrator kan godkjenne eller avslå søknader.
- Brukeren får beskjed om avgjørelsen.
- Systemet kontrollerer tilgjengelighet ved godkjenning.

Bookingstatuser:
- `PENDING` – Venter på godkjenning.
- `APPROVED` – Bekreftet booking.
- `REJECTED` – Avslått.
- `CANCELLED` – Kansellert.

## Foreslått teknologistack

| Komponent | Teknologi |
|---|---|
| Frontend | React + TypeScript |
| Design | Tailwind CSS |
| Kalender | FullCalendar |
| Backend | Spring Boot (Java) |
| Database | PostgreSQL |
| Autentisering | Spring Security |
| Deployment | Docker Compose |

## Databasemodell

Sentrale tabeller:

- `users` – Brukerkontoer og roller.
- `organizations` – Organisasjoner.
- `memberships` – Kobling mellom brukere og organisasjoner.
- `rooms` – Rom og informasjon.
- `room_access` – Bookingrettigheter per organisasjon og rom.
- `bookings` – Bookinger, søknader og statuser.

## Mulige tilleggsfunksjoner

- E-postvarsler ved søknad, godkjenning og avslag.
- ICS/iCal-abonnement for Google Kalender.
- Import av eksisterende kalenderdata.
- Bookinghistorikk.
- Gjentakende bookinger.
- Begrensning på bookinglengde og hvor langt frem man kan booke.

## Må avklares med Velferdstinget

1. Skal systemet erstatte Google Kalender helt?
2. Kan brukere tilhøre flere organisasjoner?
3. Skal noen organisasjoner kunne booke rom direkte mens andre må søke?
4. Skal ventende søknader reservere tidsrommet?
5. Hvem kan se hvilke rom og bookinger?
6. Skal organisasjonene ha egne administratorer?
7. Skal det være begrensninger på bookingvarighet og antall bookinger?

## MVP – Første versjon

1. Innlogging og brukeradministrasjon.
2. Organisasjoner, rom og tilgangsstyring.
3. Kalender med dag-, uke- og månedsvisning.
4. Direktebooking uten dobbeltbooking.
5. Søknadsbasert booking.
6. Administrasjonspanel for godkjenning og avslag.

## Arkitektur og hosting

Systemet skal hostes på egne servere og bygges som en Single Page Application (SPA).

- **Frontend:** React + TypeScript + Vite.
- **Rendering:** Client-side rendering (CSR), ingen server-side rendering (SSR).
- **UI:** Tailwind CSS + FullCalendar.
- **Backend:** Spring Boot REST API. (python fastapi vurderes)
- **Database:** PostgreSQL.
- **Kommunikasjon:** HTTPS og JSON.
- **Deployment:** Docker Compose.
- **Webserver:** Nginx for statisk frontend.

### Prinsipper
- Frontend rendres i brukerens nettleser.
- Backend håndterer autentisering, autorisasjon og bookinglogikk.
- Database er kun tilgjengelig fra backend.
- Ingen tilgangsregler håndheves utelukkende i frontend.
- Systemet skal kunne driftes uten eksterne skytjenester.

### Deployment
- React bygges til statiske HTML-, CSS- og JavaScript-filer.
- Nginx serverer frontend.
- Spring Boot kjører som separat API-tjeneste.
- PostgreSQL kjører som egen databasetjeneste.
- Tjenestene kjøres i Docker-containere på egne servere.

## Github repo
- Legge github repo i fribyte sitt?

**Mål:** Et enkelt og brukervennlig bookingsystem som føles som Google Kalender, men automatisk håndhever Velferdstingets bookingregler.

## Fremdriftsplan
- Faste tider / rom
- Mangeee organisasjoner
- iCal 
- SpringSecurity
- Innlogging (google konto, github?, osv....)
- Rom og tilganger må kunne takle mange organisasjoner og mange rom enklere.
- Gjerne ikke se 100% likt ut som google kalender, men ha en enkel og oversiktlig kalender som er lett å bruke.
- Klikk and drop tider for å flytte bookinger.