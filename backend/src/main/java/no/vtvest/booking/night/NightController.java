package no.vtvest.booking.night;

import static no.vtvest.booking.night.NightDtos.*;

import java.util.List;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Natt in Administrasjon: coming events past midnight and the guards ordered for them. System admins only. */
@RestController
class NightController {

    private final NightService night;
    private final CurrentUser currentUser;

    NightController(NightService night, CurrentUser currentUser) {
        this.night = night;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/admin/night")
    List<NightEvent> list() {
        return night.list(currentUser.require());
    }

    /** Coming events past midnight without guards ordered: {@code count}, for the tab's badge. */
    @GetMapping("/api/admin/night/count")
    NightCount count() {
        return new NightCount(night.countWithoutGuards(currentUser.require()));
    }

    @PutMapping("/api/admin/night/guards")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void setGuards(@RequestBody SetGuards body) {
        night.setGuards(currentUser.require(), body);
    }
}
