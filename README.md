# Velferdstinget Vest – Bookingsystem

Rombookingsystem for Velferdstinget Vest. Organisasjonene booker møterom og lokaler i en kalender som ligner Google Kalender, men med tilgangsstyring per organisasjon og rom, søknader som administrator godkjenner, og regler som hindrer dobbeltbooking.


## Funksjoner

- **Kalender** med dag-, uke- og månedsvisning, filtrering på rom og visning av ledige og opptatte tider.
- **Organisasjoner og tilganger.** Brukere tilhører én eller flere organisasjoner og booker på vegne av dem. Hver organisasjon har én av tre tilganger per rom:

  | Tilgang | Betydning |
  |---|---|
  | `DIRECT` | Kan booke direkte |
  | `REQUEST` | Må søke, og en administrator godkjenner eller avslår |
  | `NONE` | Kan ikke booke |

- **Søknader og godkjenning.** Ledigheten sjekkes på nytt når en søknad godkjennes. Søkeren ser avgjørelsen og en eventuell kommentar.
- **Offentlig forespørselsskjema** på `/soknad` for å låne fellesarealene i Studentvillaen uten konto. Skjemaet tilbyr rommene administrator har merket «Kan forespørres» (eller ingen preferanse), ber om én eller flere ansvarlige personer (navn, organisasjon, kortnummer og telefon) og informerer om at alle arrangementer må ha villavakt. Systemadministrator ser forespørslene under Administrasjon → Forespørsler, avslår dem eller oppretter en booking, vanligvis for den felles organisasjonen «Eksterne». Søkeren får svar på e-post; systemet sender ingen e-post selv.
- **Gjentakende bookinger** hver 1–4 uke, som kan endres én og én eller «denne og følgende».
- **Bookingregler:** ingen dobbeltbooking, maks 22 timer per booking (07:00–05:00), maks 180 dager frem i tid, og ingen rom kan brukes mellom kl. 05:00 og 07:00. Rom kan i tillegg ha faste åpningstider per ukedag.
- **Roller:** systemadministrator (brukere, organisasjoner, rom, tilganger og godkjenning) og organisasjonsadministrator (medlemmene i egen organisasjon). Et rom kan forvaltes av en organisasjon («Forvaltes av»); da godkjenner og avslår organisasjonsadministratorene der søknadene for rommet under «Til godkjenning», i tillegg til systemadministrator.
- **Innlogging** med e-post og passord. Nye brukere får et midlertidig passord som må byttes ved første innlogging.

## Teknologi

| Del | Teknologi |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, FullCalendar |
| Backend | Spring Boot (Java 21), Spring Security |
| Database | PostgreSQL med Flyway-migreringer |
| Drift | Docker Compose, Nginx, ferdigbygde images på GHCR |

Frontend er en SPA som bygges til statiske filer og serveres av Nginx. All autorisasjon og alle bookingregler håndheves i backend.

## Kom i gang lokalt

Krever Docker. `make dev` og `make test` trenger i tillegg Java 21 og Node 22.

```bash
make dev               # PostgreSQL i Docker, backend og frontend med hot reload → http://localhost:5173
make bootstrap-admin   # første gang: oppretter den første systemadministratoren
```

Databasen starter tom, uten testbrukere eller eksempeldata. Logg inn med administratoren og opprett organisasjoner, rom og brukere under **Administrasjon**.

| Kommando | Hva den gjør |
|---|---|
| `make dev` | Utvikling med hot reload → http://localhost:5173 |
| `make up` / `make down` | Hele løsningen i Docker → http://localhost:8088 (bare lokalt, ikke produksjon) |
| `make test` | Frontend- og backendtester |
| `make e2e` | Ende-til-ende-test mot en lokal app som kjører (se `frontend/README.md`) |
| `make reset-db` | Sletter utviklingsdatabasen etter bekreftelse |

## Produksjon

Produksjon kjører tre containere med `compose.prod.yaml`: Nginx (frontend og proxy til `/api/`), Spring Boot og PostgreSQL. Bare Nginx er tilgjengelig fra verten, og den skal ligge bak en HTTPS-reverse proxy (påkrevd, fordi sesjonsinformasjonskapselen er `Secure`).

```bash
cp .env.example .env && chmod 600 .env   # sett DB_PASSWORD, HTTP_BIND/HTTP_PORT og TRUSTED_PROXY
make prod-up                             # starter og venter til tjenestene er friske
make prod-bootstrap-admin                # første systemadministrator (bare én gang)
```

Hver push til `main` bygger og publiserer images til `ghcr.io/fribyte-code/vt-booking-backend` og `vt-booking-frontend`. Oppdater serveren med `make prod-pull` (ta backup først).

Fullstendig veiledning, med reverse proxy, backup, gjenoppretting og konfigurasjon: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Dokumentasjon

| Dokument | Innhold |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Hvordan systemet er bygd opp |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Drift i produksjon |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Hva som er avklart med Velferdstinget, og hva som er åpent |
| [`docs/README.md`](docs/README.md) | Opprinnelig kravspesifikasjon og notater |
| [`backend/README.md`](backend/README.md) | Oppsett av backend og API-referanse |
| [`frontend/README.md`](frontend/README.md) | Oppsett, arkitektur og kjente begrensninger |
