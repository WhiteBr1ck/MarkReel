export type UserGlobalRole = "admin" | "user";

export type StoreUser = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  avatarObjectKey: string | null;
  avatarContentType: string | null;
  avatarPreset: string | null;
  globalRole: UserGlobalRole;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type StoreUserProfile = {
  id: string;
  username: string;
  displayName: string | null;
  avatarObjectKey: string | null;
  avatarContentType: string | null;
  avatarPreset: string | null;
  globalRole: UserGlobalRole;
  createdAt: Date;
  updatedAt: Date;
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
  userFindById(id: string): Promise<StoreUser | null>;
  userCreateOrRevive(args: {
    username: string;
    passwordHash: string;
    displayName: string | null;
    globalRole?: UserGlobalRole;
  }): Promise<StoreUser>;
  userEnsureAdmin(args: {
    username: string;
    passwordHash: string;
    displayName: string | null;
  }): Promise<StoreUser>;
  userUpdateProfile(args: {
    userId: string;
    displayName: string | null;
    avatarObjectKey: string | null;
    avatarContentType: string | null;
    avatarPreset: string | null;
  }): Promise<StoreUser | null>;
  userChangePassword(args: {
    userId: string;
    passwordHash: string;
    nextSessionVersion: number;
  }): Promise<StoreUser | null>;
  userList(): Promise<StoreUserProfile[]>;
  userCreateByAdmin(args: {
    username: string;
    passwordHash: string;
    displayName: string | null;
    globalRole?: UserGlobalRole;
  }): Promise<StoreUser>;
  adminUpdateUserProfile(args: {
    userId: string;
    displayName: string | null;
  }): Promise<StoreUser | null>;
  adminResetUserPassword(args: {
    userId: string;
    passwordHash: string;
    nextSessionVersion: number;
  }): Promise<StoreUser | null>;
  userSoftDelete(args: { userId: string }): Promise<StoreUser | null>;

  projectListForUser(userId: string): Promise<StoreProject[]>;
  projectCreate(args: { userId: string; name: string }): Promise<StoreProject>;
  projectGetForUser(args: { userId: string; projectId: string }): Promise<StoreProject | null>;
  projectRenameForUser(args: { userId: string; projectId: string; name: string }): Promise<StoreProject | null>;
  projectDeleteForUser(args: { userId: string; projectId: string }): Promise<StoreProject | null>;
};
