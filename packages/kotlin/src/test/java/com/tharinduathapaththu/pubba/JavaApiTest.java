package com.tharinduathapaththu.pubba;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** The API as a Java (or older Android) codebase sees it. */
class JavaApiTest {
    @Test
    void readsFromJava() throws Exception {
        String json = new String(Files.readAllBytes(Paths.get(System.getProperty("pubba.conformance"), "bundles", "portfolio-fiction.json")), "UTF-8");
        Events events = new Events();
        List<Map<String, Object>> seen = new ArrayList<>();
        events.on(seen::add);
        Pubba pubba = Pubba.load(json, events);

        MatchResult m = pubba.match("synthpd");
        assertEquals("entity", m.getIntent());
        assertEquals("project:synthpad", m.getEntity().getId());

        GuideOptions options = new GuideOptions();
        options.setRoute(e -> "app://items/" + e.getId());
        Guide guide = new Guide(pubba, options);
        Reply reply = guide.ask("anything like kiri wallet");
        assertEquals("similar", reply.getKind());
        assertEquals("app://items/project:kiri-merchant", reply.getAction().getUrl());

        guide.follow("project:kiri-merchant", "typed");
        assertEquals(java.util.Collections.singletonList("project:kiri-merchant"), guide.getTrail().get());
        assertTrue(PubbaEvents.summarise(seen).getUsedGuide());
        assertTrue(PubbaText.closeTo("flutr", "flutter"));
    }
}
