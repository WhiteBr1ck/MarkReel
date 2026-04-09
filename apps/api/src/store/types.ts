export type StoreUser = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: Date;
};

export type StoreProject = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Store = {
  kind: "db" | "inmemory";

  userFindByUsername(username: string): Promise<StoreUser | null>;
  userFindById(id: string): Promise<Pick<StoreUser, "id" | "username" | "displayName" | "createdAt"> | null>;
  userCreateOrRevive(args: {
    username: string;
    passwordHash: string;
    displayName: string | null;
  }): Promise<Pick<StoreUser, "id" | "username" | "displayName" | "createdAt">>;

  projectListForUser(userId: string): Promise<StoreProject[]>;
  projectCreate(args: { userId: string; name: string }): Promise<StoreProject>;
  projectGetForUser(args: { userId: string; projectId: string }): Promise<StoreProject | null>;
  projectRenameForUser(args: { userId: string; projectId: string; name: string }): Promise<StoreProject | null>;
  projectDeleteForUser(args: { userId: string; projectId: string }): Promise<StoreProject | null>;
};
