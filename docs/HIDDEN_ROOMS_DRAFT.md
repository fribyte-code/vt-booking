# Utkast: skjule rom (Q-40)

Status: utkast på branchen `feature/hidden-rooms`, til diskusjon. Ikke merget.

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

## Åpne valg

1. **Egen innstilling, eller skal `Ingen` alltid skjule?** Utkastet bruker en egen innstilling per
   rom. Det enkleste alternativet er at `Ingen` alltid betyr usynlig, uten noe nytt felt. Men det
   endrer oppførselen for alle rom, og rommets standard er `Ingen` i databasen.
2. **Organisasjoner eller personer?** «Folk og organisasjoner» i notatet: utkastet skjuler bare per
   organisasjon. Å skjule for enkeltpersoner krever en egen tabell (bruker × rom) og et eget
   grensesnitt. Det bør vente til noen trenger det.
3. **Brukere uten organisasjon** ser ingen skjulte rom. Er det riktig?
4. **Stengte rom:** synligheten bruker den konfigurerte tilgangen og ser bort fra romstatus. Medlemmer
   ser derfor et stengt rom de vanligvis har tilgang til. Alternativet er å skjule det også.
5. **Søknadsskjemaet (/soknad):** innstillingen gjelder ikke der. Et rom som er både skjult og «Kan
   forespørres», vises fortsatt offentlig. Bør de to utelukke hverandre?
6. **Hva lekker fortsatt:** prøver noen å booke et skjult rom via API-et med en rom-id de kjenner,
   får de «ingen tilgang», ikke «finnes ikke». Rommet blir heller ikke skjult i nattvisningen og
   forespørselslistene, men de er uansett bare for systemadministratorer.
7. **Skal en organisasjon miste synet av sine egne bookinger** når den mister tilgangen? Utkastet sier
   nei, og det virker riktig.
8. **Grensesnitt:** innstillingen ligger nå i «Rediger rom». Den kunne også ligge i
   «Tilganger»-dialogen, der matrisen den bygger på vises.

## Ikke gjort / ikke verifisert

- Integrasjonstestene er skrevet, men ikke kjørt (Docker/Testcontainers manglet lokalt). Backend og
  testkode kompilerer.
- Frontend er ikke typesjekket eller lintet (Node manglet lokalt).
- `ARCHITECTURE.md` og `DEPLOY_CHECKLIST.md` er ikke oppdatert før løsningen er bestemt.
