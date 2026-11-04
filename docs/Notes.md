
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
- Kan ikke ha flerne rom med samme farge? eller kanskje? Endre default farge til en ikke tatt? men ikke tvinge til det? x 
- Rom og tilganger view litt bedre (Klikke inn og se alle tilganger for hver organisasjon og kan endre) x
- Multitenant løsning? (flere organisasjoner med egne adminer og bookinger osv)
- Arkiverte brukere / rom / organisasjoner i en egen tabell? ish? også mulighet for å slette helt?
- Profilbilde skal kun være 1 bokstav dersom andre første bokstav ikke er bokstav. 
- Legge til zoom in og ut knapper?



### Etter første møte / tilbakemeldinger
- Over midnatt, må være mulig men merkes med stjerne eller noe. (Han må kontakte vektere) - MAX priotering x
- Annerledes UI, velge annet UI. horisontal løsnings. hvert rom kommer nedover i rader. 1 dag om gangen. kolloner bortover tider. Cavnas? (ikke ta vekk original, men endre view) -Høy priotering x
- Kunne filtrere på åpne søknader, osv rom, hvem som er der osv x

- Kan kunne legge inn en søknad anonymt, også uten å logge inn. Kulturstyre nettside skjema. Samme felter 

- rom moderator. Ny rolle. Enkelt rom eller flerne rom. Rolle. Ansvar for noen rom - Middels 

- Over 2 uker gamlet, auto hide. Bookiner default hidden men kanskje der uansett 

- Mottar søknad, aksepterte. Logg for de. Mye av arbeidet er han så legger inn. Mer skjema accept. Ønsker en logg for hva han legger inn også. Litt usikker her. Vente.
- Ønsker en chat funksjon, private chatter -Lav priotering
- Ved opprettelse av bruker, ta vekk at man må skrive næverandre passord igjen.
- Slette demo versionen fra lokalt?
