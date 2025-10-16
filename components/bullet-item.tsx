import type React from "react";

import { observer } from "mobx-react-lite";
import { useRef, useEffect, useState } from "react";
import {
  ChevronRight,
  Circle,
  MoveUp,
  MoveDown,
  Indent,
  Outdent,
  Trash2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IBullet } from "@/lib/store";
import { useStore } from "@/lib/store-context";
import { useNavigate } from "react-router-dom";
import { isAlive } from "mobx-state-tree";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

interface BulletItemProps {
  bullet: IBullet;
  level?: number;
  onFocus?: (bulletId: string) => void;
  focusedBulletId?: string | null;
  parentBullet?: IBullet | null;
  searchQuery?: string;
  onDeleteRequest?: (bulletId: string) => void;
}

export const BulletItem = observer(
  ({
    bullet,
    level = 0,
    onFocus,
    focusedBulletId,
    parentBullet = null,
    searchQuery = "",
    onDeleteRequest,
  }: BulletItemProps) => {
    const store = useStore();
    const navigate = useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const contextRef = useRef<HTMLDivElement>(null);
    const [isContextFocused, setIsContextFocused] = useState(false);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const [touchStartY, setTouchStartY] = useState<number | null>(null);
    const [swipeOffset, setSwipeOffset] = useState(0);
    const showContext =
      (isAlive(bullet) && !!bullet.context) || isContextFocused;

    const hasChildren = isAlive(bullet) ? bullet.children.length > 0 : false;

    interface VisibleChildrenFilter {
      bullet: IBullet;
      searchQuery: string;
      children: IBullet[];
    }

    const getVisibleChildren = ({
      bullet,
      searchQuery,
      children,
    }: VisibleChildrenFilter): IBullet[] => {
      if (!isAlive(bullet)) return [];

      if (searchQuery) {
        return children.filter((child: IBullet) =>
          store.bulletMatchesSearch(child, searchQuery)
        );
      }

      return children;
    };

    const visibleChildren: IBullet[] = getVisibleChildren({
      bullet,
      searchQuery,
      children: isAlive(bullet) ? bullet.children : [],
    });

    useEffect(() => {
      if (!isAlive(bullet)) return;

      if (
        contentRef.current &&
        contentRef.current.textContent !== bullet.content
      ) {
        const selection = window.getSelection();
        const isCurrentlyFocused =
          document.activeElement === contentRef.current;
        const cursorPosition =
          isCurrentlyFocused && selection?.rangeCount
            ? selection.getRangeAt(0).startOffset
            : 0;

        contentRef.current.textContent = bullet.content;

        if (isCurrentlyFocused && contentRef.current.firstChild) {
          const range = document.createRange();
          const sel = window.getSelection();
          const textNode = contentRef.current.firstChild;
          const offset = Math.min(
            cursorPosition,
            textNode.textContent?.length || 0
          );
          range.setStart(textNode, offset);
          range.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    }, [bullet.content]);

    useEffect(() => {
      if (!isAlive(bullet)) return;

      if (
        contextRef.current &&
        contextRef.current.textContent !== bullet.context
      ) {
        contextRef.current.textContent = bullet.context;
      }
    }, [bullet.context]);

    useEffect(() => {
      if (!isAlive(bullet)) return;

      if (
        focusedBulletId === bullet.id &&
        contentRef.current &&
        document.activeElement !== contentRef.current
      ) {
        contentRef.current.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        if (contentRef.current.firstChild) {
          const textNode = contentRef.current.firstChild;
          const offset = textNode.textContent?.length || 0;
          range.setStart(textNode, offset);
          range.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    }, [focusedBulletId, bullet.id]);

    const handleContentChange = () => {
      if (!isAlive(bullet)) return;

      if (contentRef.current) {
        const newContent = contentRef.current.textContent || "";
        if (newContent !== bullet.content) {
          bullet.setContent(newContent);
          store.saveToLocalStorage();
        }
      }
    };

    const handleContextChange = () => {
      if (!isAlive(bullet)) return;

      if (contextRef.current) {
        const newContext = contextRef.current.textContent || "";
        if (newContext !== bullet.context) {
          bullet.setContext(newContext);
          store.saveToLocalStorage();
        }
      }
    };

    const handleBulletClick = (e: React.MouseEvent) => {
      if (!isAlive(bullet)) return;

      e.stopPropagation();
      store.zoomToBullet(bullet.id);
      navigate(`/${bullet.id}`);
    };

    const handleToggleCollapse = (e: React.MouseEvent) => {
      if (!isAlive(bullet)) return;

      e.stopPropagation();
      bullet.toggleCollapsed();
      store.saveToLocalStorage();
    };

    const handleContentFocus = () => {
      if (!isAlive(bullet)) return;

      if (onFocus) {
        onFocus(bullet.id);
      }
    };

    const handleContextFocus = () => {
      if (!isAlive(bullet)) return;

      setIsContextFocused(true);
      if (onFocus) {
        onFocus(bullet.id);
      }
    };

    const handleContextBlur = () => {
      if (!isAlive(bullet)) return;

      if (!bullet.context) {
        setIsContextFocused(false);
      }
    };

    const handleContextKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode("\n");
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          selection.removeAllRanges();
          selection.addRange(range);
          handleContextChange();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (contentRef.current) {
          contentRef.current.focus();
          const range = document.createRange();
          const sel = window.getSelection();
          if (contentRef.current.firstChild) {
            const textNode = contentRef.current.firstChild;
            const offset = textNode.textContent?.length || 0;
            range.setStart(textNode, offset);
            range.collapse(true);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
      }
      // Allow all other keys (Shift+Enter, arrows, etc.) to work normally for text editing
    };

    const handleTouchStart = (e: React.TouchEvent) => {
      const touch = e.touches[0];
      setTouchStartX(touch.clientX);
      setTouchStartY(touch.clientY);
      setSwipeOffset(0);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (touchStartX === null || touchStartY === null) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;

      // Only handle horizontal swipes (ignore vertical scrolling)
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        setSwipeOffset(deltaX);
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      if (touchStartX === null) return;

      const threshold = 50; // Minimum swipe distance in pixels

      if (swipeOffset > threshold) {
        // Swipe right - indent
        store.indentBullet(bullet.id);
      } else if (swipeOffset < -threshold) {
        // Swipe left - outdent
        store.outdentBullet(bullet.id);
      }

      setTouchStartX(null);
      setTouchStartY(null);
      setSwipeOffset(0);
    };

    const handleMoveUp = () => {
      if (!isAlive(bullet)) return;
      store.moveBulletUp(bullet.id);
    };

    const handleMoveDown = () => {
      if (!isAlive(bullet)) return;
      store.moveBulletDown(bullet.id);
    };

    const handleIndent = () => {
      if (!isAlive(bullet)) return;
      store.indentBullet(bullet.id);
    };

    const handleOutdent = () => {
      if (!isAlive(bullet)) return;
      store.outdentBullet(bullet.id);
    };

    const formatBulletAsText = (bullet: IBullet, indent = 0): string => {
      if (!isAlive(bullet)) return "";

      const indentStr = "  ".repeat(indent);
      let text = `${indentStr}- ${bullet.content}\n`;

      if (bullet.context) {
        text += `${indentStr}  Notes: ${bullet.context}\n`;
      }

      for (const child of bullet.children) {
        text += formatBulletAsText(child, indent + 1);
      }

      return text;
    };

    const handleCopy = async () => {
      if (!isAlive(bullet)) return;

      const formattedText = formatBulletAsText(bullet);
      try {
        await navigator.clipboard.writeText(formattedText);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    };

    const handleDelete = () => {
      if (!isAlive(bullet)) return;

      if (onDeleteRequest) {
        onDeleteRequest(bullet.id);
      } else {
        // Fallback to direct delete if callback not provided
        store.deleteBullet(bullet.id);
      }
    };

    // Early return if bullet is not alive to prevent rendering detached objects
    if (!isAlive(bullet)) {
      return null;
    }

    return (
      <div
        className="bullet-wrapper"
        data-bullet-id={bullet.id}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform:
            swipeOffset !== 0
              ? `translateX(${Math.max(-100, Math.min(100, swipeOffset))}px)`
              : undefined,
          transition: swipeOffset === 0 ? "transform 0.2s ease-out" : undefined,
        }}
      >
        <div className="flex items-start gap-2 group">
          <div className="flex items-center gap-1 pt-1">
            {hasChildren ? (
              <button
                onClick={handleToggleCollapse}
                className="w-4 h-4 flex items-center justify-center hover:bg-accent rounded transition-colors touch-manipulation"
                aria-label={bullet.collapsed ? "Expand" : "Collapse"}
              >
                <ChevronRight
                  className={cn(
                    "w-3 h-3 text-muted-foreground transition-transform duration-200",
                    !bullet.collapsed && "rotate-90"
                  )}
                />
              </button>
            ) : (
              <div className="w-4" />
            )}

            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  onClick={handleBulletClick}
                  className="w-5 h-5 flex items-center justify-center hover:bg-accent rounded transition-colors group/bullet touch-manipulation"
                  aria-label="Zoom to bullet or right-click for options"
                >
                  <Circle className="w-2 h-2 fill-[var(--color-bullet)] text-[var(--color-bullet)] group-hover/bullet:fill-[var(--color-bullet-hover)] group-hover/bullet:text-[var(--color-bullet-hover)] transition-colors" />
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-56">
                <ContextMenuItem onClick={handleMoveUp}>
                  <MoveUp className="mr-2 h-4 w-4" />
                  Move Up
                </ContextMenuItem>
                <ContextMenuItem onClick={handleMoveDown}>
                  <MoveDown className="mr-2 h-4 w-4" />
                  Move Down
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleIndent}>
                  <Indent className="mr-2 h-4 w-4" />
                  Indent
                </ContextMenuItem>
                <ContextMenuItem onClick={handleOutdent}>
                  <Outdent className="mr-2 h-4 w-4" />
                  Outdent
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleCopy}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={handleDelete}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>

          <div className="flex-1 min-w-0">
            <div
              ref={contentRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleContentChange}
              onFocus={handleContentFocus}
              className="bullet-content text-foreground leading-relaxed focus:outline-none"
              data-placeholder="Type something..."
            />

            <div
              ref={contextRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleContextChange}
              onFocus={handleContextFocus}
              onBlur={handleContextBlur}
              onKeyDown={handleContextKeyDown}
              className={cn(
                "bullet-context text-muted-foreground text-sm leading-relaxed focus:outline-none pl-4 border-l-2 border-border transition-all duration-200 whitespace-pre-wrap",
                showContext
                  ? "block mt-1 animate-in fade-in slide-in-from-top-2"
                  : "absolute opacity-0 pointer-events-none h-0 overflow-hidden"
              )}
              data-placeholder="Add notes..."
            />
          </div>
        </div>

        {!bullet.collapsed && visibleChildren.length > 0 && (
          <div className="ml-6 mt-1 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
            {visibleChildren.map((child) => (
              <BulletItem
                key={child.id}
                bullet={child}
                level={level + 1}
                onFocus={onFocus}
                focusedBulletId={focusedBulletId}
                parentBullet={bullet}
                searchQuery={searchQuery}
                onDeleteRequest={onDeleteRequest}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

BulletItem.displayName = "BulletItem";
