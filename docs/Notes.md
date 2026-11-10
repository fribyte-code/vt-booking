
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

- Kan kunne legge inn en søknad anonymt, også uten å logge inn. Kulturstyre nettside skjema. Samme felter x

- rom moderator. Ny rolle. Enkelt rom eller flerne rom. Rolle. Ansvar for noen rom - Middels ?

- Over 2 uker gamlet, auto hide. Bookiner default hidden men kanskje der uansett
Lagret halvt år, 
- Kanskje egen historikk fane? 200 og så laste inn flere?, men kunne søke uansett, akkurat slik han gjør i excel nå.

- Mottar søknad, aksepterte. Logg for de. Mye av arbeidet er han så legger inn. Mer skjema accept. Ønsker en logg for hva han legger inn også. Litt usikker her. Vente.
- Ønsker en chat funksjon, private chatter -Lav priotering
- Ved opprettelse av bruker, ta vekk at man må skrive næverandre passord igjen. x
- Slette demo versionen fra lokalt?




## Andre møte
1. Søknadsskjemaet (/soknad)
- Valget «Annet rom» i tillegg til Festplassen/Torgallmenningen
- Villavakt er påkrevd. Skjemaet skal informere om det, ikke spørre om det (dekker begge villavakt-punktene).
- Kontaktpersoner: navn, organisasjon, kortnummer (ikke studentnummer) og telefon. Én person som standard, med mulighet for å legge til flere. 
- Liten hjelpetekst under tidspunkt om at sluttiden kan være neste dag ?? Var det ikke, ikke tekst? endre den lille tekste
- Feilmeldingen skal vises øverst, ikke nederst. Når en godkjenner rommene osvv.

2. Arrangementer etter midnatt
- Regel: ingen booking som slutter etter kl. 05:00 dagen etter
- Det må være veldig tydelig når et arrangement går over midnatt, både i skjemaet og for admin (kanskje egen "nattfane")
- Etter midnatt trengs det også vektere, ikke bare villavakt. Dette håndteres ved at admin sender e-post til vektere

3. Behandling av forespørsler (Administrasjon → Forespørsler)
- Egen status: ubehandlet, under arbeid, ferdig, avslått, og mulighet for å sortere og filtrere på den
- Flere filtre, eventuelt en visning som ligner bookinglisten, der man klikker seg inn for alle detaljene
- Kunne redigere en forespørsel etter at den er behandlet, i samme fane
- Undertekster som skiller «ventende søknader» (villaorganisasjonene) fra «forespørsler» (eksterne)

4. Brukeradministrasjon
- Søk og filter på navn, e-post og organisasjon

5. Rom og grunndata
- Legge til Museplassen
- Engen tilhører Studentersamfunnet, så den trenger riktig organisasjon og romtilgang
    - "Admin"/moderator for rommet må være funksjonær i Studentersamfunnet
- Standardrom: enten vise tydelig hvilket som er valgt, eller fjerne forvalget, visue det visuelt på den siden hvor du kan endre romtilganger.

6. Ting å avklare
- Gamle bookinger ved sletting/arkivering: dette er allerede løst. Arkivering beholder bookingene, og sletting (kun av arkiverte rom) fjerner alle bookingene i rommet. Kanskje UI-et bare må forklare det bedre.
- E-post (mal og varsling til vektere): appen har ingen SMTP i dag, fordi det ble valgt bort i MVP-en. Begge krever derfor en arkitekturbeslutning. Alternativet er å generere en ferdig e-posttekst som admin kopierer eller åpner med mailto:. (tenker best å lage mail mal)
- «Endre mail-malen etter hvert» høres selv ut som noe som kan vente.

7. rom rolle
- Engen skal ikke erlend få inn bookinger, men en i samfunnet (nestleder der eller noe).
- Tilsvarende for andre ting, at noen har ansvar for egne rom, organisasjon har ansvar for rom og godtar roller.
- Kunne "gjømme" rom for folk og organisasjoner?
- Uib kantine: Kan ikke bookes før 16:30, kun (16:30 - 24:00) i hverdager, i helger (08:00 - 16:00), lørdag søndag.

- Fra 7 am to 5am bookinger.

Prioritering mot fristen (litt før desember, rundt tre uker): Gruppe 1, 2 (unntatt e-post) og 5 er relativt avgrenset og har størst verdi for de som søker. Gruppe 3 og 4 er admin-komfort. Egen status på forespørsler krever en ny migrering (V9). E-post bør få en egen beslutning først.
Setter brukergrensesnitt høyt.
