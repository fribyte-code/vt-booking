package no.vtvest.booking.room;

import java.util.List;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rooms")
class RoomController {

    private final RoomService roomService;
    private final CurrentUser currentUser;

    RoomController(RoomService roomService, CurrentUser currentUser) {
        this.roomService = roomService;
        this.currentUser = currentUser;
    }

    @GetMapping
    List<RoomResponse> list() {
        return roomService.listRooms(currentUser.require());
    }
}
