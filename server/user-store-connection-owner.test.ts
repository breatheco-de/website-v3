import { describe, expect, it } from "vitest";
import { _setUsersStateForTests, usersStateForGcs } from "./user-store";

describe("usersStateForGcs", () => {
  it("omits connectionTokenOwner users", () => {
    _setUsersStateForTests({
      users: {
        alice: {
          id: "alice",
          username: "alice",
          roles: ["user_admin"],
        },
        "dev-local": {
          id: "dev-local",
          username: "dev-local",
          roles: ["user_admin"],
          connectionTokenOwner: true,
        },
      },
    });
    const forGcs = usersStateForGcs();
    expect(forGcs.users.alice).toBeDefined();
    expect(forGcs.users["dev-local"]).toBeUndefined();
  });
});
