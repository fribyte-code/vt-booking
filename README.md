# Velferdstinget Vest – Bookingsystem

## Prosjektbeskrivelse

Utvikle et webbasert rombookingsystem for Velferdstinget Vest. Systemet skal erstatte eller supplere Google Kalender, med et lignende kalendergrensesnitt, men med tilgangsstyring og bookingregler.

## Kom i gang

Krever Docker. `make dev`, `make demo` og `make test` trenger i tillegg Java 21 og Node 22.

| Kommando | Hva den gjør |
|---|---|
| `make dev` | PostgreSQL i Docker, Spring Boot og React (API-modus) lokalt med hot reload. Åpne http://localhost:5173. Demoen som «Prøv demo» lenker til kjører på http://localhost:5174/demo/. |
| `make demo` | Frittstående demo med testdata i nettleseren, uten backend. Åpne http://localhost:5173. |
| `make test` | Frontend- og backendtester |
| `make e2e` | Ende-til-ende-test av bookingflyten mot en lokal app som kjører (`make dev`, eller `make up` med `E2E_BASE_URL=http://localhost:8088`). Krever `E2E_ADMIN_EMAIL` og `E2E_ADMIN_PASSWORD` for en systemadministrator i den lokale databasen. Testdataene lages og arkiveres gjennom admin-API-et. |
| `make up` | Hele løsningen i Docker (PostgreSQL, Spring Boot, Nginx). Åpne http://localhost:8088. Demoen ligger på http://localhost:8088/demo/. |
| `make down` | Stopper containerne. Dataene beholdes. |
| `make bootstrap-admin` | Oppretter den første systemadministratoren (interaktivt) |
| `make reset-db` | Sletter utviklingsdatabasen etter bekreftelse |

Databasen starter tom: det finnes ingen testbrukere, delte passord eller eksempeldata. Første gang oppretter du en systemadministrator med `make bootstrap-admin` (spør etter e-post, navn og passord i terminalen, og nekter hvis det allerede finnes en). Logg inn med den, og opprett organisasjoner, rom og brukere under **Administrasjon**. Nye brukere får et midlertidig passord som må byttes ved første innlogging.

- «Prøv demo» på innloggingssiden åpner den frittstående demoen. Demoen er et eget bygg med testdata i nettleseren, og den kontakter aldri backend eller databasen.
- `make dev` stopper backend, frontend og demo med Ctrl+C. Backend starter på nytt automatisk når Java-koden kompileres på nytt, for eksempel fra IDE-en eller med `./mvnw compile`.
- `make up` kjører backend med Spring-profilen `dev` (standard databasepassord og informasjonskapsler uten HTTPS). Oppsettet er bare for lokal testing, ikke for produksjon. Produksjon kjøres med `compose.prod.yaml` og `make prod-*`; se `docs/DEPLOYMENT.md`.
- Produksjonsbygget av frontend inneholder aldri demodata eller brukerbytte. Det lokale oppsettet bygger frontend med `WITH_DEMO=true` for å vise demoen ved siden av.
- Bytt port for `make up` med `make up APP_PORT=9000`.

Mer dokumentasjon: `docs/ARCHITECTURE.md` (hvordan systemet virker), `backend/README.md` (API og regler), `frontend/README.md` (datamoduser og demo) og `docs/OPEN_QUESTIONS.md` (hva som er avklart med Velferdstinget).

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

## Teknologistack

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
- Gjentakende bookinger (implementert: ukentlige serier).
- Begrensning på bookinglengde og hvor langt frem man kan booke (implementert: maks 12 timer og 180 dager frem).

## Må avklares med Velferdstinget

Status for hvert spørsmål står i `docs/OPEN_QUESTIONS.md`.


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
- **Backend:** Spring Boot REST API.
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

### Fremdriftsplan
- Faste tider / rom
- Mangeee organisasjoner
- iCal 
- SpringSecurity
- Innlogging (google konto, github?, osv....)
- Rom og tilganger må kunne takle mange organisasjoner og mange rom enklere.
- Gjerne ikke se 100% likt ut som google kalender, men ha en enkel og oversiktlig kalender som er lett å bruke.
- Klikk and drop tider for å flytte bookinger.
- Kunne legge til rom


### Fremtidige forbedringer
- Create docker image Ci x
- Automatisk oppdatere bookinger osv som kommer (trenger godkjenning?) x
- iCal til kalender iphone typ x
- Stillbart booking detaljer om tid og uker osv?
- Kan ikke ha flerne rom med samme farge? eller kanskje? Endre default farge til en ikke tatt? men ikke tvinge til det?
- Rom og tilganger view litt bedre (Klikke inn og se alle tilganger for hver organisasjon og kan endre)
- Tilganger osv ? brukere typ
- Multitenant løsning? (flere organisasjoner med egne adminer og bookinger osv)
- 


