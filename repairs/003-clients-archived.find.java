                // Explicit fixture id (JPA save() would ignore it on an IDENTITY column).
                jdbc.update("INSERT INTO clients (id, name, email) VALUES (?, ?, ?)",
                        ((Number) client.get("id")).longValue(), client.get("name"),
                        client.get("email"));
