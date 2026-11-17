# Utkast: skjule rom (Q-40)

Status: løsningen er avgjort (se nederst). Ligger på branchen `feature/hidden-rooms`, ikke merget.

## Problemet

Fra notatene (7. rom rolle): «Kunne "gjømme" rom for folk og organisasjoner?»

I dag ser alle innloggede alle aktive rom i kalenderen, og alle godkjente bookinger i dem. Tilgangen
`Ingen` (NONE) hindrer bare booking, den skjuler ikke rommet.

## Forslaget

En ny innstilling per rom: **«Skjul rommet for de uten tilgang»** (`rooms.hidden_without_access`,
standard av).

Når den er på, ser bare disse rommet:

- medlemmer av en aktiv organisasjon som har tilgang til rommet (`Direkte` eller `Søknad`, fra egen
  innstilling eller rommets standard)
- organisasjonsadministratorene i organisasjonen som forvalter rommet («Forvaltes av»)
- systemadministratorer

Alle andre ser verken rommet i kalenderen eller bookingene i det. Hvis de slår opp en booking direkte
(lenke, `.ics`), får de «finnes ikke». En organisasjon ser likevel alltid sine egne bookinger, også
om rommet senere blir skjult for den.

Hvem som ser rommet, styres altså av den samme tilgangsmatrisen som i dag («Tilganger»). Det kommer
ingen ny liste over hvem som ser hva. Innstillingen bestemmer bare om `Ingen` også betyr «usynlig».

## Hvorfor slik

- Det er lite å vedlikeholde. Admin setter tilgang ett sted, og synligheten følger med.
- Det er bakoverkompatibelt. Av som standard gir samme oppførsel som nå for alle eksisterende rom.
- Regelen håndheves i backend (`RoomVisibility`, brukt av `RoomService.listRooms` og `Viewer.sees`),
  ikke bare i frontend.

## Endringer i koden

| Hvor | Hva |
|---|---|
| `V13__hidden_rooms.sql` | Ny kolonne `hidden_without_access boolean NOT NULL DEFAULT false` |
| `room/RoomVisibility.java` | Ny: én SQL-spørring som gir rommene som er skjult for en bruker |
| `room/Room.java`, `RoomService.java` | Feltet, og `/api/rooms` utelater skjulte rom |
| `booking/Viewer.java`, `BookingService.java` | `sees()` skjuler godkjente bookinger i skjulte rom (gjelder kalender, oppslag, serier og `.ics`) |
| `admin/AdminDtos.java`, `AdminService.java` | Feltet kan leses og settes. `null` ved oppdatering betyr uendret |
| `RoomsAdmin.tsx`, `adminApi.ts` | Avkrysningsboks i romdialogen og merket «Skjult uten tilgang» i romlisten |
| `HiddenRoomIntegrationTest.java` | Tester for standard, skjult, forvalter, egne bookinger og at feltet beholdes |

## Avgjort (november 2026)

Alle valgene ble avgjort med Patrik, og utkastet beholdes slik det er bygget:

1. **Egen innstilling, av som standard.** `Ingen` skjuler ikke rommet av seg selv.
2. **Per organisasjon holder.** Ingen skjuling for enkeltpersoner.
3. **Brukere uten organisasjon** ser ingen skjulte rom. Det er greit.
4. **Stengt og skjult holdes adskilt.** Synligheten ser bort fra romstatus, så medlemmer ser fortsatt
   et stengt rom de vanligvis har tilgang til.
5. **Søknadsskjemaet (/soknad):** skjult og «Kan forespørres» utelukker ikke hverandre. Rommene står
   uansett på nettsiden. Poenget med å skjule er bare å slippe støy i kalenderen og vise hva en
   organisasjon kan booke.
6. **Booking av et skjult rom via API-et** gir «ingen tilgang», ikke «finnes ikke». Det er greit, og
   mer nyttig. Nattvisningen og forespørselslistene er bare for systemadministratorer og skjuler ikke
   rommet.
7. **Grensesnitt:** innstillingen ligger i «Rediger rom».

Ikke tatt opp, men slik det er bygget: en organisasjon ser alltid sine egne bookinger, også om den
senere mister tilgangen til et skjult rom.

## Ikke verifisert

- Integrasjonstestene er skrevet, men ikke kjørt (Docker/Testcontainers manglet lokalt). Backend og
  testkode kompilerer.
- Frontend er ikke typesjekket eller lintet (Node manglet lokalt).
