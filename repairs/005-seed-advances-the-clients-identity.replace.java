        // FIXTURE REPAIR 005: advance the clients IDENTITY past every explicitly seeded id
        // BEFORE inserting them. /reset does TRUNCATE ... RESTART IDENTITY, which sets the
        // sequence back to 1, and seeding an explicit id does not move it — so the next row
        // created through the UI is assigned an id that is already taken. H2 does not raise:
        // the insert silently becomes a no-op (200, empty body, no new row), which is why this
        // surfaced as "expected 2 rows, got 1" with nothing in any log.
        List<Map<String, Object>> seededClients = (List<Map<String, Object>>) fixture.get("clients");
        if (seededClients != null) {
            for (Map<String, Object> seeded : seededClients) {
                jdbc.execute("ALTER TABLE clients ALTER COLUMN id RESTART WITH "
                        + (((Number) seeded.get("id")).longValue() + 1));
            }
        }
        List<Map<String, Object>> clients = (List<Map<String, Object>>) fixture.get("clients");
