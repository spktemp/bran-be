import { _parseQueryIntentForTests } from "../../../src/modules/ai/ai.service";

const users = [
  { id: "user-1", name: "Amisha Sharma", email: "amisha@example.com" },
  { id: "user-2", name: "Sudeep Purwar", email: "sudeep@example.com" },
  { id: "user-3", name: "Admin", email: "admin@bran.app" }
];

const requester = users[2];

describe("AI query intent — self-referential", () => {
  it('maps "what did I do this week" to the requesting user', () => {
    const intent = _parseQueryIntentForTests("what did I do this week", users, requester);

    expect(intent.scope).toBe("user");
    expect(intent.userId).toBe("user-3");
    expect(intent.userName).toBe("Admin");
  });

  it("defaults to the requesting user when no subject is named", () => {
    const intent = _parseQueryIntentForTests("summarize this week", users, requester);

    expect(intent.scope).toBe("user");
    expect(intent.userId).toBe("user-3");
  });

  it("still resolves another person when named explicitly", () => {
    const intent = _parseQueryIntentForTests("what did Amisha do this week", users, requester);

    expect(intent.scope).toBe("user");
    expect(intent.userId).toBe("user-1");
    expect(intent.userName).toBe("Amisha Sharma");
  });

  it("still resolves team queries", () => {
    const intent = _parseQueryIntentForTests("how is the team doing this week", users, requester);

    expect(intent.scope).toBe("team");
    expect(intent.userId).toBeNull();
  });
});
