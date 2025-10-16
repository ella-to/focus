import { types, type Instance, getSnapshot, detach } from "mobx-state-tree";
import { nanoid } from "nanoid";

export const Bullet: any = types
  .model("Bullet", {
    id: types.identifier,
    content: types.string,
    context: types.optional(types.string, ""),
    children: types.array(types.late(() => Bullet)),
    collapsed: types.optional(types.boolean, false),
    createdAt: types.optional(types.number, () => Date.now()),
  })
  .actions((self) => ({
    setContent(content: string) {
      self.content = content;
    },
    setContext(context: string) {
      self.context = context;
    },
    toggleCollapsed() {
      self.collapsed = !self.collapsed;
    },
    setCollapsed(collapsed: boolean) {
      self.collapsed = collapsed;
    },
    addChild(bullet: Instance<typeof Bullet>) {
      self.children.push(bullet);
    },
    removeChild(id: string) {
      const index = self.children.findIndex((child) => child.id === id);
      if (index !== -1) {
        self.children.splice(index, 1);
      }
    },
    insertChildAt(index: number, bullet: Instance<typeof Bullet>) {
      self.children.splice(index, 0, bullet);
    },
    removeChildAndReturn(id: string): Instance<typeof Bullet> | null {
      const index = self.children.findIndex((child) => child.id === id);
      if (index !== -1) {
        const child = self.children[index];
        self.children.splice(index, 1);
        return child;
      }
      return null;
    },
  }));

export const RootStore = types
  .model("RootStore", {
    bullets: types.array(Bullet),
    zoomedBulletId: types.maybeNull(types.string),
    history: types.array(types.frozen()),
    historyIndex: types.optional(types.number, -1),
    searchQuery: types.optional(types.string, ""),
  })
  .views((self) => ({
    get zoomedBullet() {
      if (!self.zoomedBulletId) return null;
      return this.findBulletById(self.zoomedBulletId);
    },
    findBulletById(
      id: string,
      bullets = self.bullets
    ): Instance<typeof Bullet> | null {
      for (const bullet of bullets) {
        if (bullet.id === id) return bullet;
        const found = this.findBulletById(id, bullet.children as any);
        if (found) return found;
      }
      return null;
    },
    getBreadcrumbs(bulletId: string): Instance<typeof Bullet>[] {
      const breadcrumbs: Instance<typeof Bullet>[] = [];
      const findPath = (id: string, bullets: any[], path: any[]): boolean => {
        for (const bullet of bullets) {
          if (bullet.id === id) {
            breadcrumbs.push(...path, bullet);
            return true;
          }
          if (findPath(id, bullet.children, [...path, bullet])) {
            return true;
          }
        }
        return false;
      };
      findPath(bulletId, self.bullets as any, []);
      return breadcrumbs;
    },
    findBulletWithContext(
      id: string,
      bullets: any[] = self.bullets,
      parent: Instance<typeof Bullet> | null = null
    ): {
      bullet: Instance<typeof Bullet>;
      parent: Instance<typeof Bullet> | null;
      siblings: any[];
      index: number;
    } | null {
      for (let i = 0; i < bullets.length; i++) {
        const bullet = bullets[i];
        if (bullet.id === id) {
          return { bullet, parent, siblings: bullets, index: i };
        }
        const found = this.findBulletWithContext(id, bullet.children, bullet);
        if (found) return found;
      }
      return null;
    },
    fuzzyMatch(text: string, query: string): boolean {
      if (!query) return true;
      const lowerText = text.toLowerCase();
      const lowerQuery = query.toLowerCase();

      // Simple fuzzy matching: check if all characters in query appear in order in text
      let queryIndex = 0;
      for (
        let i = 0;
        i < lowerText.length && queryIndex < lowerQuery.length;
        i++
      ) {
        if (lowerText[i] === lowerQuery[queryIndex]) {
          queryIndex++;
        }
      }
      return queryIndex === lowerQuery.length;
    },
    bulletMatchesSearch(
      bullet: Instance<typeof Bullet>,
      query: string
    ): boolean {
      if (!query) return true;

      // Check if bullet content or context matches
      if (
        this.fuzzyMatch(bullet.content, query) ||
        this.fuzzyMatch(bullet.context, query)
      ) {
        return true;
      }

      // Check if any child matches
      for (const child of bullet.children) {
        if (this.bulletMatchesSearch(child, query)) {
          return true;
        }
      }

      return false;
    },
    get filteredBullets() {
      if (!self.searchQuery) {
        return this.zoomedBullet ? this.zoomedBullet.children : self.bullets;
      }

      const bullets = this.zoomedBullet
        ? this.zoomedBullet.children
        : self.bullets;
      return bullets.filter((bullet: Instance<typeof Bullet>) =>
        this.bulletMatchesSearch(bullet, self.searchQuery)
      );
    },
  }))
  .actions((self) => ({
    setSearchQuery(query: string) {
      self.searchQuery = query;
    },
    saveToHistory() {
      const snapshot = {
        bullets: getSnapshot(self.bullets),
        zoomedBulletId: self.zoomedBulletId,
      };
      // Remove any history after current index
      self.history.splice(self.historyIndex + 1);
      self.history.push(snapshot as any);
      self.historyIndex = self.history.length - 1;

      // Limit history to 100 items
      if (self.history.length > 100) {
        self.history.shift();
        self.historyIndex--;
      }
    },
    undo() {
      if (self.historyIndex > 0) {
        self.historyIndex--;
        const snapshot = self.history[self.historyIndex] as any;
        self.bullets.clear();
        snapshot.bullets.forEach((b: any) =>
          self.bullets.push(Bullet.create(b))
        );
        self.zoomedBulletId = snapshot.zoomedBulletId;
      }
    },
    redo() {
      if (self.historyIndex < self.history.length - 1) {
        self.historyIndex++;
        const snapshot = self.history[self.historyIndex] as any;
        self.bullets.clear();
        snapshot.bullets.forEach((b: any) =>
          self.bullets.push(Bullet.create(b))
        );
        self.zoomedBulletId = snapshot.zoomedBulletId;
      }
    },
    indentBullet(bulletId: string) {
      const context = self.findBulletWithContext(bulletId);
      if (!context) return false;

      const { bullet, index } = context;

      // Can't indent if it's the first bullet (no previous sibling)
      if (index === 0) return false;

      // Get the previous sibling
      const prevBullet = context.siblings[index - 1];

      // Detach so we can reparent without killing observers
      const detachedBullet = detach(bullet);

      // Add as child of previous sibling using same instance
      prevBullet.addChild(detachedBullet);

      this.saveToHistory();
      this.saveToLocalStorage();
      return true;
    },
    outdentBullet(bulletId: string) {
      const context = self.findBulletWithContext(bulletId);
      if (!context) return false;

      const { bullet, parent } = context;

      // Can't outdent if already at root level
      if (!parent) return false;

      const parentContext = self.findBulletWithContext(parent.id);
      if (!parentContext) return false;

      // Detach before re-inserting elsewhere
      const detachedBullet = detach(bullet);

      // Add as sibling of parent (right after parent)
      if (parentContext.parent) {
        parentContext.parent.insertChildAt(
          parentContext.index + 1,
          detachedBullet
        );
      } else {
        self.bullets.splice(parentContext.index + 1, 0, detachedBullet);
      }

      this.saveToHistory();
      this.saveToLocalStorage();
      return true;
    },
    createAndInsertBullet(afterBulletId: string, asChild = false) {
      const newBullet = Bullet.create({
        id: nanoid(),
        content: "",
        context: "",
        children: [],
      });

      const context = self.findBulletWithContext(afterBulletId);
      if (!context) return null;

      const { bullet, parent, index } = context;

      if (asChild) {
        bullet.insertChildAt(0, newBullet);
      } else {
        if (parent) {
          parent.insertChildAt(index + 1, newBullet);
        } else {
          self.bullets.splice(index + 1, 0, newBullet);
        }
      }

      this.saveToHistory();
      this.saveToLocalStorage();
      return newBullet;
    },
    deleteBullet(bulletId: string, skipConfirmation = false) {
      const context = self.findBulletWithContext(bulletId);
      if (!context) {
        return { success: false, hasChildren: false };
      }

      const { bullet, parent } = context;

      // Check if bullet has children
      const hasChildren = bullet.children.length > 0;

      // If has children and not skipping confirmation, return info for dialog
      if (hasChildren && !skipConfirmation) {
        return { success: false, hasChildren: true, bulletId };
      }

      if (self.zoomedBulletId) {
        const zoomedBullet = self.findBulletById(self.zoomedBulletId);

        // Check if this is the last child of the zoomed bullet
        if (
          zoomedBullet &&
          zoomedBullet.children.length === 1 &&
          zoomedBullet.children[0].id === bulletId
        ) {
          // Delete the last child (and its children if any)
          zoomedBullet.removeChild(bulletId);
          // Create a new empty bullet
          const newBullet = this.createEmptyBullet(zoomedBullet);
          this.saveToHistory();
          this.saveToLocalStorage();
          return {
            success: true,
            hasChildren: false,
            newBulletId: newBullet?.id,
          };
        }
      } else {
        if (self.bullets.length === 1 && self.bullets[0].id === bulletId) {
          // Delete the only bullet (and its children if any)
          self.bullets.splice(0, 1);
          // Create a new empty bullet
          const newBullet = this.createEmptyBullet(null);
          this.saveToHistory();
          this.saveToLocalStorage();
          return {
            success: true,
            hasChildren: false,
            newBulletId: newBullet?.id,
          };
        }
      }

      // Normal deletion
      if (parent) {
        parent.removeChild(bullet.id);
      } else {
        const index = self.bullets.findIndex((b) => b.id === bullet.id);
        if (index !== -1) {
          self.bullets.splice(index, 1);
        }
      }

      this.saveToHistory();
      this.saveToLocalStorage();
      return { success: true, hasChildren: false };
    },
    zoomToBullet(id: string | null) {
      self.zoomedBulletId = id;

      // If zooming into a bullet with no children, create an empty bullet
      if (id) {
        const bullet = self.findBulletById(id);
        if (bullet && bullet.children.length === 0) {
          const newBullet = Bullet.create({
            id: nanoid(),
            content: "",
            context: "",
            children: [],
          });
          bullet.addChild(newBullet);
          this.saveToLocalStorage();

          // Focus the new bullet after a short delay
          setTimeout(() => {
            const contentDiv = document.querySelector(
              `[data-bullet-id="${newBullet.id}"] .bullet-content`
            ) as HTMLDivElement;
            if (contentDiv) {
              contentDiv.focus();
            }
          }, 50);
        }
      }

      this.saveToHistory();
    },
    zoomOut() {
      if (!self.zoomedBulletId) return;

      const breadcrumbs = self.getBreadcrumbs(self.zoomedBulletId);
      if (breadcrumbs.length > 1) {
        // Zoom to parent (second to last in breadcrumbs)
        const parent = breadcrumbs[breadcrumbs.length - 2];
        self.zoomedBulletId = parent.id;
      } else {
        // Already at top level, zoom out to root
        self.zoomedBulletId = null;
      }

      this.saveToHistory();
    },
    loadFromLocalStorage() {
      if (typeof window === "undefined") return;
      const saved = localStorage.getItem("focus-data");
      if (saved) {
        try {
          const data = JSON.parse(saved);
          self.bullets.clear();
          data.bullets.forEach((b: any) => self.bullets.push(Bullet.create(b)));
          // Initialize history with loaded state
          this.saveToHistory();
        } catch (e) {
          console.error("Failed to load from localStorage", e);
        }
      } else {
        // Initialize with a welcome bullet
        const welcomeBullet = Bullet.create({
          id: nanoid(),
          content: "Welcome to Focus!",
          context:
            "Press Shift+Enter to add notes. Click the bullet dot to zoom in.",
          children: [],
        });
        const child1 = Bullet.create({
          id: nanoid(),
          content: "Press Enter to create a new bullet",
          context: "",
          children: [],
        });
        const child2 = Bullet.create({
          id: nanoid(),
          content: "Press Tab to indent",
          context: "",
          children: [],
        });
        const child3 = Bullet.create({
          id: nanoid(),
          content: "Press Shift+Tab to outdent",
          context: "",
          children: [],
        });
        welcomeBullet.addChild(child1);
        welcomeBullet.addChild(child2);
        welcomeBullet.addChild(child3);
        self.bullets.push(welcomeBullet);
        this.saveToHistory();
      }
    },
    saveToLocalStorage() {
      if (typeof window === "undefined") return;
      const data = {
        bullets: getSnapshot(self.bullets),
      };

      localStorage.setItem("focus-data", JSON.stringify(data, null, 2));
    },
    exportData() {
      const data = {
        bullets: getSnapshot(self.bullets),
        zoomedBulletId: self.zoomedBulletId,
        exportedAt: new Date().toISOString(),
      };
      return JSON.stringify(data, null, 2);
    },
    importData(jsonString: string) {
      try {
        const data = JSON.parse(jsonString);
        if (!data.bullets || !Array.isArray(data.bullets)) {
          throw new Error("Invalid data format");
        }

        self.bullets.clear();
        data.bullets.forEach((b: any) => self.bullets.push(Bullet.create(b)));
        self.zoomedBulletId = null;

        // Reset history and save current state
        self.history.clear();
        self.historyIndex = -1;
        this.saveToHistory();
        this.saveToLocalStorage();

        return true;
      } catch (e) {
        console.error("Failed to import data", e);
        return false;
      }
    },
    resetToDefault() {
      self.bullets.clear();
      self.zoomedBulletId = null;

      // Create welcome bullet
      const welcomeBullet = Bullet.create({
        id: nanoid(),
        content: "Welcome to Focus!",
        context:
          "Press Shift+Enter to add notes. Click the bullet dot to zoom in.",
        children: [],
      });
      const child1 = Bullet.create({
        id: nanoid(),
        content: "Press Enter to create a new bullet",
        context: "",
        children: [],
      });
      const child2 = Bullet.create({
        id: nanoid(),
        content: "Press Tab to indent",
        context: "",
        children: [],
      });
      const child3 = Bullet.create({
        id: nanoid(),
        content: "Press Shift+Tab to outdent",
        context: "",
        children: [],
      });
      welcomeBullet.addChild(child1);
      welcomeBullet.addChild(child2);
      welcomeBullet.addChild(child3);
      self.bullets.push(welcomeBullet);

      // Reset history
      self.history.clear();
      self.historyIndex = -1;
      this.saveToHistory();
      this.saveToLocalStorage();
    },
    moveBulletUp(bulletId: string) {
      const context = self.findBulletWithContext(bulletId);
      if (!context) {
        return false;
      }

      const { bullet, index, siblings } = context;

      // Can't move up if it's the first bullet
      if (index === 0) {
        return false;
      }

      // Detach node so we can reinsert without killing observers
      const detachedBullet = detach(bullet);

      // Insert at previous position using the same instance
      siblings.splice(index - 1, 0, detachedBullet);

      this.saveToHistory();
      this.saveToLocalStorage();
      return true;
    },
    moveBulletDown(bulletId: string) {
      const context = self.findBulletWithContext(bulletId);
      if (!context) {
        return false;
      }

      const { bullet, index, siblings } = context;

      // Can't move down if it's the last bullet
      if (index >= siblings.length - 1) {
        return false;
      }

      // Detach node so we can reinsert without killing observers
      const detachedBullet = detach(bullet);

      // Insert at next position using the same instance
      siblings.splice(index + 1, 0, detachedBullet);

      this.saveToHistory();
      this.saveToLocalStorage();
      return true;
    },
    createEmptyBullet(parent: Instance<typeof Bullet> | null) {
      const newBullet = Bullet.create({
        id: nanoid(),
        content: "",
        context: "",
        children: [],
      });

      if (parent) {
        parent.addChild(newBullet);
      } else {
        self.bullets.push(newBullet);
      }

      this.saveToHistory();
      this.saveToLocalStorage();

      // Focus the new bullet after a short delay
      setTimeout(() => {
        const contentDiv = document.querySelector(
          `[data-bullet-id="${newBullet.id}"] .bullet-content`
        ) as HTMLDivElement;
        if (contentDiv) {
          contentDiv.focus();
        }
      }, 50);

      return newBullet;
    },
    setZoomedBulletId(id: string | null) {
      self.zoomedBulletId = id;
    },
  }));

export interface IBullet extends Instance<typeof Bullet> {}
export interface IRootStore extends Instance<typeof RootStore> {}

let store: IRootStore | null = null;

export function initializeStore() {
  if (store === null) {
    store = RootStore.create({
      bullets: [],
      zoomedBulletId: null,
      history: [],
      historyIndex: -1,
      searchQuery: "",
    });
  }
  return store;
}

export function getStore() {
  return store;
}
