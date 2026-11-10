
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
- Valget «Annet rom» i tillegg til Festplassen/Torgallmenningen x dobbeltsjekk.
- Villavakt er påkrevd. Skjemaet skal informere om det, ikke spørre om det (dekker begge villavakt-punktene). x
- Kontaktpersoner: navn, organisasjon, kortnummer (ikke studentnummer) og telefon. Én person som standard, med mulighet for å legge til flere. x
- Liten hjelpetekst under tidspunkt om at sluttiden kan være neste dag ?? Var det ikke, ikke tekst? endre den lille tekste x
- Feilmeldingen skal vises øverst, ikke nederst. Når en godkjenner rommene osvv.

2. Arrangementer etter midnatt
- Det må være veldig tydelig når et arrangement går over midnatt, både i skjemaet og for admin (kanskje egen "nattfane")
- Etter midnatt trengs det også vektere, ikke bare villavakt. Dette håndteres ved at admin sender e-post til vektere x

3. Behandling av forespørsler (Administrasjon → Forespørsler)
- Egen status: ubehandlet, under arbeid, ferdig, avslått, og mulighet for å sortere og filtrere på den x
- Flere filtre, eventuelt en visning som ligner bookinglisten, der man klikker seg inn for alle detaljene
    filtre ja, ikke bookingliste lignende enda. 
- Kunne redigere en forespørsel etter at den er behandlet, i samme fane
    Oppdaterer seg ikke når booking endres? 
- Undertekster som skiller «ventende søknader» (villaorganisasjonene) fra «forespørsler» (eksterne)

4. Brukeradministrasjon
- Søk og filter på navn, e-post og organisasjon, Kan ikke søke på organisasjon enda.

5. Rom og grunndata
- Legge til Museplassen (vent til produksjon) kanskje lage en oversikt over hvordan rommene vil se ut?
- Engen tilhører Studentersamfunnet, så den trenger riktig organisasjon og romtilgang x
    - "Admin"/moderator for rommet må være funksjonær i Studentersamfunnet 
- Standardrom: enten vise tydelig hvilket som er valgt, eller fjerne forvalget, visue det visuelt på den siden hvor du kan endre romtilganger.

6. Ting å avklare
- Gamle bookinger ved sletting/arkivering: dette er allerede løst. Arkivering beholder bookingene, og sletting (kun av arkiverte rom) fjerner alle bookingene i rommet. Kanskje UI-et bare må forklare det bedre.
- E-post (mal og varsling til vektere): appen har ingen SMTP i dag, fordi det ble valgt bort i MVP-en. Begge krever derfor en arkitekturbeslutning. Alternativet er å generere en ferdig e-posttekst som admin kopierer eller åpner med mailto:. (tenker best å lage mail mal) x
- «Endre mail-malen etter hvert» høres selv ut som noe som kan vente.

7. rom rolle
- Engen skal ikke erlend få inn bookinger, men en i samfunnet (nestleder der eller noe).
- Tilsvarende for andre ting, at noen har ansvar for egne rom, organisasjon har ansvar for rom og godtar roller.
- Kunne "gjømme" rom for folk og organisasjoner?
- Uib kantine: Kan ikke bookes før 16:30, kun (16:30 - 24:00) i hverdager, i helger (08:00 - 16:00), lørdag søndag.


Prioritering mot fristen (litt før desember, rundt tre uker): Gruppe 1, 2 (unntatt e-post) og 5 er relativt avgrenset og har størst verdi for de som søker. Gruppe 3 og 4 er admin-komfort. Egen status på forespørsler krever en ny migrering (V9). E-post bør få en egen beslutning først.
Setter brukergrensesnitt høyt.

### Ferdig
- Fra 7 am to 5am bookinger. x
- Regel: ingen booking som slutter etter kl. 05:00 dagen etter x



Kan hukes av (x)

Andre møte
- 1 Søknadsskjemaet: alle punktene.
  - «Annet rom» ble løst på en annen måte: skjemaet viser rommene admin merker «Kan forespørres», pluss «Ingen preferanse».
  - Villavakt vises som informasjon.
  - Kontaktpersoner er på plass.
  - Hjelpeteksten om neste dag står under tidspunkt, og midnattsboksen viser sluttdag.
  - Feilmeldingen vises øverst.
- 2 Etter midnatt:
  - Det er tydelig i både skjema og admin (midnattsboks, «Nattbooking»-merke, «Natt»-visning).
  - E-post til vektere finnes som ferdig mal («Send til vektere»).
- 3 Forespørsler:
  - Egen status med sortering og filter.
  - Redigering etter behandling i samme fane.
- 5 Rom:
  - Engen kan tilhøre Samfunnet («Forvaltes av»).
  - Standardrom er fjernet fra booking-dialogen.
- 6 Avklare:
  - Gamle bookinger ved arkivering og sletting var allerede løst.
  - E-postmal for svar og for vektere er laget med mailto:.
- 7 Romrolle: alt unntatt «gjemme rom»: romansvarlig per organisasjon, og åpningstider for UiB-kantina.

Eldre lister
- «rom moderator. Ny rolle» er løst som romansvarlig, uten ny rolle.
- «Faste tider / rom» er løst med åpningstider per rom.
- «Klikk and drop tider for å flytte bookinger» finnes allerede: dra i kalenderen.
- «Kunne legge til rom» finnes.

Delvis
- Egen nattfane: natt-visningen ligger inne i Forespørsler og viser ikke ventende søknader. Den står allerede under «Neste».
- «Flere filtre … visning som ligner bookinglisten»: filtrene er på plass, men forespørslene vises fortsatt som detaljkort.
- Brukersøk: navn og e-post fantes fra før, organisasjon mangler (steg 4).
- Museplassen: trenger ingen kode, bare oppsett i admin. Gjenstår ved deploy.
- iCal: enkeltbookinger kan legges i kalenderen, men det finnes ikke noe abonnement (det er fortsatt «Mulige tilleggsfunksjoner»).

Ikke gjort
- Undertekster for ventende søknader og forespørsler (steg 4).
- Gjemme rom for enkelte personer og organisasjoner.
- Bedre UI-forklaring av hva arkivering og sletting gjør med bookinger.
- Fra eldre lister:
  - Avatar med bare én bokstav. Koden tar i dag første tegn i hvert ord, uten å sjekke om det er en bokstav.
  - Zoom-knapper.
  - Historikkfane eller automatisk skjuling av gamle bookinger.
  - Logg over hva admin legger inn.
  - Chat.

