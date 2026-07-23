export type UserGlobalRole = "admin" | "user";
export type StoreProjectRole = "owner" | "editor" | "commenter" | "viewer";
export type StoreProjectPermission = "manage" | "upload" | "view";

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
  lastLoginAt: Date | null;
  disabledAt: Date | null;
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
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type StoreProject = {
  id: string;
  name: string;
  ownerId: string;
  owner?: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
  organizationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  role?: StoreProjectRole;
  accessSource?: "admin" | "owner" | "project_grant" | "legacy_member";
  capabilities?: string[];
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
  userRecordLogin(args: { userId: string }): Promise<StoreUser | null>;
  userList(args?: { includeDeleted?: boolean }): Promise<StoreUserProfile[]>;
  userCreateByAdmin(args: {
    username: string;
    passwordHash: string;
    displayName: string | null;
    globalRole?: UserGlobalRole;
  }): Promise<StoreUser>;
  adminUpdateUserProfile(args: {
    userId: string;
    displayName: string | null;
    globalRole?: UserGlobalRole;
  }): Promise<StoreUser | null>;
  adminResetUserPassword(args: {
    userId: string;
    passwordHash: string;
    nextSessionVersion: number;
  }): Promise<StoreUser | null>;
  userSoftDelete(args: { userId: string }): Promise<StoreUser | null>;
  adminSetUserDisabled(args: { userId: string; disabled: boolean }): Promise<StoreUser | null>;
  adminRestoreUser(args: { userId: string }): Promise<StoreUser | null>;

  projectListForUser(userId: string): Promise<StoreProject[]>;
  projectCreate(args: { userId: string; name: string; organizationId?: string | null; organizationPermission?: StoreProjectPermission | null }): Promise<StoreProject>;
  projectGetForUser(args: { userId: string; projectId: string }): Promise<StoreProject | null>;
  projectRenameForUser(args: { userId: string; projectId: string; name: string }): Promise<StoreProject | null>;
  projectDeleteForUser(args: { userId: string; projectId: string }): Promise<StoreProject | null>;
};
