"use client";

import {
  AnimatePresence,
  type HTMLMotionProps,
  m,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  Children,
  cloneElement,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useId,
  useState,
} from "react";
import { SPRING_LAYOUT } from "@prime-agent/web-design/lib/ease";
import { cn } from "@prime-agent/web-design/lib/utils";

export interface SharedLayoutBgProps
  extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  children: ReactNode;
  /** Semantic container used for the children. */
  as?: "div" | "ul";
  /** Tailwind class applied to the moving pill. Defaults to a subtle foreground tint. */
  pillClassName?: string;
  /** Horizontal inset of the pill relative to each row (px). Default 20. */
  inset?: number;
  /** Optional positioning override for the pill wrapper inside each item. */
  pillContainerClassName?: string;
}

const variants: Variants = {
  initial: { opacity: 0, filter: "blur(6px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  exit: (isActive: boolean) =>
    !isActive ? { opacity: 0, filter: "blur(6px)" } : {},
};

const reducedVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: (isActive: boolean) => (!isActive ? { opacity: 0 } : {}),
};

export const SharedLayoutBg = forwardRef<HTMLElement, SharedLayoutBgProps>(
  function SharedLayoutBg(
    {
      children,
      as = "div",
      className,
      onMouseLeave,
      pillClassName,
      pillContainerClassName,
      inset = 20,
      ...props
    },
    forwardedRef,
  ) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const uid = useId();
  const reduce = useReducedMotion();

    const renderedChildren = Children.toArray(children).reduce<ReactNode[]>(
      (result, child, index) => {
        if (!isValidElement(child)) return result;
        const el = child as ReactElement<{
          className?: string;
          onMouseEnter?: () => void;
          children?: ReactNode;
        }>;
        const childKey = el.key ? String(el.key) : `item-${index}`;
        result.push(cloneElement(
          el,
          {
            key: childKey,
            className: cn("relative", el.props.className),
            onMouseEnter: () => {
              el.props.onMouseEnter?.();
              setActiveId(childKey);
            },
          },
          <>
            <AnimatePresence custom={activeId !== null}>
              {activeId !== null ? (
                <m.div
                  variants={reduce ? reducedVariants : variants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  custom={activeId !== null}
                  className={cn(
                    "pointer-events-none absolute inset-y-0",
                    pillContainerClassName,
                  )}
                  style={{ left: -inset, right: -inset }}
                >
                  {activeId === childKey ? (
                    <m.div
                      layoutId={`shared-bg-${uid}`}
                      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                      className={cn(
                        "pointer-events-none h-full w-full rounded-2xl bg-primary/[0.06]",
                        pillClassName,
                      )}
                    />
                  ) : null}
                </m.div>
              ) : null}
            </AnimatePresence>
            <div className="relative z-10">{el.props.children}</div>
          </>,
        ));
        return result;
      },
      [],
    );

    const handleMouseLeave = (event: MouseEvent<HTMLElement>) => {
      setActiveId(null);
      onMouseLeave?.(event);
    };

    // layoutRoot scopes the pill's layout projection to this list, so fixed or
    // scrolled ancestors can't smear scroll offsets into its movement.
    return as === "ul" ? (
      <m.ul
        {...(props as HTMLMotionProps<"ul">)}
        ref={forwardedRef as Ref<HTMLUListElement>}
        layoutRoot
        onMouseLeave={handleMouseLeave}
        className={cn("flex w-full flex-col", className)}
      >
        {renderedChildren}
      </m.ul>
    ) : (
      <m.div
        {...(props as HTMLMotionProps<"div">)}
        ref={forwardedRef as Ref<HTMLDivElement>}
        layoutRoot
        onMouseLeave={handleMouseLeave}
        className={cn("flex w-full flex-col", className)}
      >
        {renderedChildren}
      </m.div>
    );
  },
);
