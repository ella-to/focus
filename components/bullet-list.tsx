import type React from "react";

import { observer } from "mobx-react-lite";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import { BulletItem } from "./bullet-item";
import { useStore } from "@/lib/store-context";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const BulletList = observer(() => {
  const store = useStore();
  const navigate = useNavigate();
  const [focusedBulletId, setFocusedBulletId] = useState<string | null>(null);
  const [deleteConfirmDialogOpen, setDeleteConfirmDialogOpen] = useState(false);
  const [bulletToDeleteWithChildren, setBulletToDeleteWithChildren] = useState<
    string | null
  >(null);
  const zoomedContextRef = useRef<HTMLDivElement>(null);

  const displayBullets = store.filteredBullets;

  useEffect(() => {
    if (store.zoomedBullet && zoomedContextRef.current) {
      if (zoomedContextRef.current.textContent !== store.zoomedBullet.context) {
        zoomedContextRef.current.textContent = store.zoomedBullet.context;
      }
    }
  }, [store.zoomedBullet]);

  const handleFocus = useCallback((bulletId: string) => {
    setFocusedBulletId(bulletId);
  }, []);

  const handleZoomedContextChange = useCallback(() => {
    if (store.zoomedBullet && zoomedContextRef.current) {
      const newContext = zoomedContextRef.current.textContent || "";
      if (newContext !== store.zoomedBullet.context) {
        store.zoomedBullet.setContext(newContext);
        store.saveToLocalStorage();
      }
    }
  }, [store]);

  const handleZoomedContextKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
      return;
    }
  }, []);

  const handleDeleteConfirmWithChildren = () => {
    if (bulletToDeleteWithChildren) {
      const result = store.deleteBullet(bulletToDeleteWithChildren, true);

      setDeleteConfirmDialogOpen(false);
      setBulletToDeleteWithChildren(null);

      if (result.success && result.newBulletId) {
        // Set focus after dialog closes
        setTimeout(() => {
          setFocusedBulletId(result.newBulletId!);
          // Also directly focus the element
          const contentDiv = document.querySelector(
            `[data-bullet-id="${result.newBulletId}"] .bullet-content`
          ) as HTMLDivElement;
          if (contentDiv) {
            contentDiv.focus();
          }
        }, 100);
      }
    }
  };

  const handleDeleteConfirmDialogOpenChange = (open: boolean) => {
    setDeleteConfirmDialogOpen(open);
    // Reset bulletToDeleteWithChildren when dialog closes
    if (!open) {
      setBulletToDeleteWithChildren(null);
    }
  };

  const findDeepestLastChild = useCallback((bullet: any): any => {
    // If bullet has no children or is collapsed, return the bullet itself
    if (
      !bullet ||
      !bullet.children ||
      bullet.children.length === 0 ||
      bullet.collapsed
    ) {
      return bullet;
    }
    // Recursively find the deepest child of the last child
    return findDeepestLastChild(bullet.children[bullet.children.length - 1]);
  }, []);

  const handleDeleteRequest = useCallback(
    (bulletId: string) => {
      const context = store.findBulletWithContext(bulletId);

      if (!context) {
        store.deleteBullet(bulletId);
        return;
      }

      const { parent, siblings } = context;
      const bulletIndex = siblings.findIndex((b: any) => b.id === bulletId);

      // Save the previous sibling ID before deletion
      const previousSiblingId =
        bulletIndex > 0 ? siblings[bulletIndex - 1].id : null;
      const isFirstChild = bulletIndex === 0;
      const isOnlyChild = siblings.length === 1;

      const result = store.deleteBullet(bulletId);

      if (result.hasChildren) {
        // Show dialog instead of window.confirm
        setBulletToDeleteWithChildren(bulletId);
        setDeleteConfirmDialogOpen(true);
        return;
      }

      if (result.success) {
        if (result.newBulletId) {
          // A new bullet was created (was the only bullet), focus it
          setTimeout(() => {
            setFocusedBulletId(result.newBulletId!);
            const contentDiv = document.querySelector(
              `[data-bullet-id="${result.newBulletId}"] .bullet-content`
            ) as HTMLDivElement;
            if (contentDiv) {
              contentDiv.focus();
            }
          }, 50);
        } else if (isOnlyChild && parent) {
          // Was the only child, focus parent
          setFocusedBulletId(parent.id);
        } else if (isFirstChild && parent) {
          // Was the first child, focus parent
          setFocusedBulletId(parent.id);
        } else if (previousSiblingId) {
          // Focus the previous sibling's deepest child
          const previousBullet = store.findBulletById(previousSiblingId);
          if (previousBullet) {
            const deepestChild = findDeepestLastChild(previousBullet);
            if (deepestChild) {
              setFocusedBulletId(deepestChild.id);
            }
          }
        } else if (!parent && siblings.length > 1) {
          // Root level, no parent, focus first remaining sibling
          const firstRemaining = siblings.find((s: any) => s.id !== bulletId);
          if (firstRemaining) {
            setFocusedBulletId(firstRemaining.id);
          }
        }
      }
    },
    [store, findDeepestLastChild]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInContext = target.classList.contains("bullet-context");

      const isInSearchInput =
        target.tagName === "INPUT" && target.getAttribute("type") === "text";
      if (isInSearchInput) {
        return;
      }

      if (isInContext) {
        if (e.key === "Escape") {
          e.preventDefault();
          const bulletWrapper = target.closest("[data-bullet-id]");
          if (bulletWrapper) {
            const contentDiv = bulletWrapper.querySelector(
              ".bullet-content"
            ) as HTMLDivElement;
            if (contentDiv) {
              contentDiv.focus();
              const range = document.createRange();
              const sel = window.getSelection();
              if (contentDiv.firstChild) {
                const textNode = contentDiv.firstChild;
                const offset = textNode.textContent?.length || 0;
                range.setStart(textNode, offset);
                range.collapse(true);
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            }
          }
        }
        return;
      }

      if (!focusedBulletId) return;

      const context = store.findBulletWithContext(focusedBulletId);
      if (!context) return;

      const { bullet, parent, siblings } = context;
      const bulletIndex = siblings.findIndex((b: any) => b.id === bullet.id);

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        store.redo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowUp" && !e.shiftKey) {
        e.preventDefault();
        store.moveBulletUp(bullet.id);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowDown" && !e.shiftKey) {
        e.preventDefault();
        store.moveBulletDown(bullet.id);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        store.zoomToBullet(bullet.id);
        navigate(`/${bullet.id}`);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "ArrowUp") {
        e.preventDefault();
        const breadcrumbs = store.getBreadcrumbs(store.zoomedBulletId!);
        if (breadcrumbs.length > 1) {
          const parent = breadcrumbs[breadcrumbs.length - 2];
          store.zoomToBullet(parent.id);
          navigate(`/${parent.id}`);
        } else {
          store.zoomToBullet(null);
          navigate("/");
        }
        return;
      }

      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !(e.metaKey || e.ctrlKey) &&
        !isInContext
      ) {
        e.preventDefault();
        const asChild = bullet.children.length > 0 && !bullet.collapsed;
        const newBullet = store.createAndInsertBullet(bullet.id, asChild);
        if (newBullet) {
          setFocusedBulletId(newBullet.id);
        }
        return;
      }

      if (e.key === "Enter" && e.shiftKey && !isInContext) {
        e.preventDefault();
        const contextDiv = document.querySelector(
          `[data-bullet-id="${bullet.id}"] .bullet-context`
        ) as HTMLDivElement;
        if (contextDiv) {
          contextDiv.focus();
          setTimeout(() => {
            const range = document.createRange();
            const sel = window.getSelection();
            if (contextDiv.firstChild) {
              const textNode = contextDiv.firstChild;
              const offset = textNode.textContent?.length || 0;
              range.setStart(textNode, offset);
              range.collapse(true);
              sel?.removeAllRanges();
              sel?.addRange(range);
            }
          }, 0);
        }
        return;
      }

      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        store.indentBullet(bullet.id);
        return;
      }

      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        store.outdentBullet(bullet.id);
        return;
      }

      if (e.key === "Backspace") {
        if (!bullet.content && !bullet.context) {
          e.preventDefault();

          handleDeleteRequest(bullet.id);
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (bulletIndex > 0) {
          setFocusedBulletId(siblings[bulletIndex - 1].id);
        } else if (parent) {
          setFocusedBulletId(parent.id);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (bullet.children.length > 0 && !bullet.collapsed) {
          setFocusedBulletId(bullet.children[0].id);
        } else if (bulletIndex < siblings.length - 1) {
          setFocusedBulletId(siblings[bulletIndex + 1].id);
        } else if (parent) {
          const parentContext = store.findBulletWithContext(parent.id);
          if (parentContext) {
            const parentIndex = parentContext.siblings.findIndex(
              (b: any) => b.id === parent.id
            );
            if (parentIndex < parentContext.siblings.length - 1) {
              setFocusedBulletId(parentContext.siblings[parentIndex + 1].id);
            }
          }
        }
        return;
      }
    },
    [focusedBulletId, store, handleDeleteRequest, navigate]
  );

  return (
    <div className="space-y-1" onKeyDown={handleKeyDown}>
      {store.zoomedBullet && store.zoomedBullet.context && (
        <div className="mb-6 pb-6 border-b border-border">
          <div className="text-sm font-medium text-muted-foreground mb-2">
            Notes
          </div>
          <div
            ref={zoomedContextRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleZoomedContextChange}
            onKeyDown={handleZoomedContextKeyDown}
            className="text-muted-foreground leading-relaxed focus:outline-none pl-4 border-l-2 border-border bg-muted/30 rounded-r p-3 whitespace-pre-wrap bullet-context"
            data-placeholder="Add notes..."
          />
        </div>
      )}

      {displayBullets.length === 0 && store.searchQuery && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-12 h-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            No bullets found
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            No bullets match your search query "{store.searchQuery}". Try a
            different search term.
          </p>
        </div>
      )}

      {displayBullets.map((bullet: any) => (
        <BulletItem
          key={bullet.id}
          bullet={bullet as any}
          onFocus={handleFocus}
          focusedBulletId={focusedBulletId}
          searchQuery={store.searchQuery}
          onDeleteRequest={handleDeleteRequest}
        />
      ))}

      <Dialog
        open={deleteConfirmDialogOpen}
        onOpenChange={handleDeleteConfirmDialogOpenChange}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bullet with Children?</DialogTitle>
            <DialogDescription>
              This bullet has nested items. Deleting it will also delete all its
              children. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirmWithChildren}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

BulletList.displayName = "BulletList";
