import {
  BookOpenText,
  ChevronDown,
  History,
  LogIn,
  LogOut,
  Plus,
  Settings,
} from "lucide-react"
import { Popover } from "../../agent-elements/input/popover"
import { ChromePillButton } from "../primitives/chrome-pill"
import type {
  ChatSessionInfo,
  ChatSessionMetadata,
} from "@prime-agent/web-protocol/chat-protocol"

const DOCUMENTATION_URL = "https://docs.qredence.ai"

function QredenceLogo({ className }: { className?: string }) {
  return (
    <svg
      width="97"
      height="93"
      viewBox="0 0 97 93"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M53.7167 0.166103C53.2688 0.240753 52.2237 0.434841 51.4026 0.59907C50.5815 0.778228 49.2676 1.10669 48.4913 1.36049C47.7149 1.6143 46.3414 2.16671 45.4306 2.59967C44.5199 3.03264 43.1762 3.79406 42.4447 4.28675C41.7131 4.77943 40.6232 5.6155 40.0559 6.13805C39.4736 6.64567 38.5778 7.54146 38.0553 8.12372C37.5327 8.69106 36.6817 9.8108 36.1592 10.5871C35.6516 11.3635 34.92 12.6475 34.5617 13.4238C34.2034 14.2002 33.7256 15.3796 33.5017 16.0366C33.2927 16.6935 32.9791 17.8281 32.8298 18.5746C32.6656 19.3062 32.4566 20.6499 32.3521 21.5606C32.2625 22.4862 32.2177 24.039 32.2625 25.1438C32.3073 26.2187 32.5163 28.0252 32.7253 29.1748C32.9343 30.3244 33.3076 31.9667 33.5465 32.8326C33.7854 33.6986 34.293 35.2364 34.6811 36.2665C35.0693 37.2967 35.771 38.9688 36.2637 39.999C36.7564 41.0291 37.6373 42.6714 38.2195 43.6568C38.8018 44.6422 39.7274 46.1202 40.2798 46.9414C40.8322 47.7625 41.7579 49.0465 42.3103 49.793C42.8776 50.5544 44.0571 51.9877 44.923 53.0029C45.789 54.0181 46.9535 55.3618 47.5208 55.9739C48.0732 56.5861 50.2829 58.9301 52.4328 61.1845C54.5827 63.4239 58.1957 67.0818 60.4799 69.3212C64.302 73.0238 64.6155 73.3822 64.3617 73.5613C64.2124 73.6808 63.5704 74.0241 62.9434 74.3526C62.3014 74.6661 61.2563 75.1439 60.6292 75.3977C59.9873 75.6515 58.8974 76.0397 58.1957 76.2786C57.494 76.5025 56.2847 76.831 55.5083 76.9952C54.732 77.1594 53.3883 77.4132 52.5223 77.5327C51.5668 77.682 49.9245 77.7715 48.3121 77.7715C46.6549 77.7715 45.0275 77.682 43.9824 77.5327C43.0568 77.3983 41.4145 77.0698 40.3545 76.8011C39.2945 76.5324 37.7418 76.0695 36.9206 75.756C36.0995 75.4425 34.6961 74.8304 33.7854 74.3675C32.8746 73.9196 31.5757 73.203 30.874 72.77C30.1723 72.3371 28.963 71.4861 28.1867 70.8889C27.4103 70.2767 26.0666 69.0824 25.2007 68.2164C24.3347 67.3505 23.0508 65.8724 22.3491 64.9319C21.6474 63.9913 20.7665 62.7073 20.3933 62.0952C20.02 61.4831 19.4825 60.5126 19.1839 59.9304C18.9003 59.3481 18.4076 58.2731 18.109 57.5416C17.7955 56.81 17.3476 55.526 17.1087 54.7049C16.8549 53.8838 16.4966 52.4804 16.3025 51.5696C16.1084 50.6589 15.8695 48.8823 15.765 47.6132C15.6306 45.8664 15.6306 44.7318 15.7501 42.985C15.8546 41.7159 16.0636 39.9691 16.2428 39.1032C16.4219 38.2373 16.7354 36.9234 16.9445 36.1919C17.1535 35.4603 17.5865 34.1763 17.9149 33.3552C18.2434 32.534 18.8853 31.1306 19.3482 30.2199C19.811 29.3092 20.5724 28.0103 21.0352 27.3086C21.4831 26.6069 22.2894 25.5021 22.8119 24.8452C23.3344 24.1883 24.484 22.9192 25.3649 22.0085C26.3055 21.0231 27.1117 20.0527 27.3357 19.5749C27.5596 19.1569 27.8433 18.3805 27.9627 17.8729C28.0821 17.3504 28.1867 16.5591 28.1867 16.1112C28.1867 15.6633 28.0821 14.8571 27.9478 14.3146C27.8283 13.7821 27.5297 12.9759 27.2759 12.528C27.0371 12.0801 26.5294 11.3784 26.1413 10.9753C25.7382 10.5722 25.0962 10.0198 24.6781 9.75108C24.275 9.48234 23.5285 9.10909 23.0359 8.94486C22.5432 8.76571 21.6623 8.58655 21.095 8.54176C20.3982 8.49199 19.7164 8.54673 19.0496 8.70599C18.4822 8.84035 17.6462 9.12402 17.1833 9.34797C16.5862 9.63164 15.7949 10.2587 14.6303 11.4083C13.6898 12.3041 12.3759 13.7075 11.719 14.5286C11.0472 15.3348 10.0469 16.6039 9.50939 17.3653C8.97192 18.1118 8.16571 19.2913 7.73274 19.993C7.29978 20.6947 6.47863 22.1279 5.92623 23.2029C5.37382 24.2778 4.64226 25.8007 4.3138 26.6069C3.97042 27.3982 3.43294 28.8464 3.08955 29.8019C2.7611 30.7723 2.29827 32.34 2.05939 33.2805C1.82051 34.2211 1.44727 35.9381 1.25318 37.0877C1.04416 38.2373 0.805284 39.9542 0.715705 40.8948C0.641056 41.8354 0.566406 43.7464 0.566406 45.1498C0.566406 46.5532 0.641056 48.4642 0.715705 49.4048C0.805284 50.3454 0.999372 51.9578 1.17853 52.988C1.34276 54.0181 1.74587 55.8694 2.05939 57.0937C2.37292 58.3329 2.94025 60.214 3.32843 61.274C3.71661 62.3341 4.41831 64.051 4.88114 65.0812C5.34396 66.1113 6.13524 67.6491 6.613 68.515C7.09076 69.381 8.01641 70.859 8.64346 71.7996C9.28545 72.7402 10.3604 74.2182 11.0621 75.0842C11.7489 75.9501 12.8537 77.2191 13.4957 77.9059C14.1377 78.5927 15.3768 79.802 16.2428 80.5784C17.1087 81.3547 18.4524 82.4894 19.2287 83.0716C20.0051 83.6688 21.4533 84.6841 22.4387 85.3261C23.424 85.968 25.1708 86.9833 26.3204 87.5805C27.47 88.1627 29.3213 89.0137 30.4261 89.4616C31.5309 89.9095 33.1135 90.4769 33.9347 90.7307C34.7558 90.9845 36.0995 91.3577 36.9206 91.5667C37.7418 91.7608 39.19 92.0744 40.1305 92.2386C41.0711 92.4028 42.9224 92.6417 44.2363 92.776C45.5501 92.8955 47.4014 93 48.342 93C49.2825 93 51.104 92.8955 52.373 92.776C53.6421 92.6566 55.4934 92.4177 56.4787 92.2386C57.4641 92.0744 58.9422 91.7608 59.7633 91.5518C60.5845 91.3577 61.8983 90.9845 62.6746 90.7307C63.451 90.4769 64.9291 89.9394 65.9592 89.5363C66.9894 89.1332 68.7063 88.3568 69.7663 87.8193L69.8023 87.8011L69.8028 87.8009C70.8519 87.2689 71.9493 86.7125 72.2298 86.5354C72.5134 86.3711 73.4689 85.774 74.3647 85.2066L75.9622 84.1914C78.3361 86.3562 80.1277 87.9985 81.4863 89.2526C83.1435 90.7605 84.2632 91.6712 84.9201 92.0146C85.4576 92.2983 86.3235 92.6417 86.861 92.7611C87.3985 92.8955 88.1301 93 88.5033 93C88.8765 93 89.5783 92.8955 90.0709 92.776C90.5636 92.6417 91.3698 92.3431 91.8625 92.1042C92.3552 91.8653 93.0271 91.4473 93.3406 91.1786C93.669 90.9098 94.2364 90.2828 94.5947 89.7901C94.953 89.2974 95.371 88.536 95.5353 88.1179C95.6846 87.685 95.8787 86.8788 95.9682 86.3264C96.0578 85.6694 96.0578 84.9528 95.9682 84.3108C95.8787 83.7435 95.6099 82.8477 95.3561 82.2953C95.1023 81.728 94.7141 81.0412 94.4902 80.7575C94.2513 80.4738 92.4448 78.742 90.4591 76.9205C88.4884 75.0842 86.861 73.5613 86.861 73.5165C86.861 73.4717 87.4731 72.5162 88.2196 71.3965C88.9661 70.2618 90.1157 68.2612 90.7726 66.9474C91.4445 65.6336 92.3104 63.7375 92.6986 62.7372C93.1017 61.7219 93.669 60.1095 93.9527 59.154C94.2513 58.1836 94.6544 56.6906 94.8485 55.8246C95.0426 54.9587 95.3113 53.6449 95.4308 52.9133C95.5651 52.1818 95.7592 50.4947 95.8936 49.1809C96.013 47.867 96.1175 46.1202 96.1175 45.2991C96.1175 44.4779 96.013 42.7013 95.8936 41.3427C95.7742 39.9841 95.5353 38.1029 95.3561 37.1623C95.1919 36.2217 94.8933 34.7735 94.6843 33.9524C94.4753 33.1312 94.0721 31.7278 93.7735 30.8171C93.4899 29.9064 92.9972 28.5328 92.6837 27.7565C92.3701 26.9801 91.8327 25.726 91.5042 24.9945C91.1608 24.2629 90.4293 22.8446 89.8769 21.8592C89.3394 20.8738 88.3241 19.2315 87.6224 18.2014C86.9357 17.1712 85.7264 15.5289 84.95 14.5436C84.1587 13.5582 82.5314 11.7666 81.337 10.5722C80.1426 9.37783 78.4704 7.84005 77.6045 7.15328C76.7386 6.46651 75.2307 5.37663 74.2453 4.71971C73.2599 4.07773 71.7221 3.18194 70.8114 2.74897C69.9007 2.30107 68.557 1.73374 67.8254 1.47993C67.0939 1.21119 65.9443 0.882737 65.2874 0.718509C64.6305 0.56921 63.3614 0.345262 62.4507 0.210893C61.3459 0.0615944 59.7782 -0.0130549 57.6731 0.00187496C55.9413 0.0168048 54.1646 0.0914542 53.7167 0.166103ZM54.2393 15.4692C54.8215 15.3348 55.4486 15.2005 55.6576 15.1706C55.8666 15.1258 56.8072 15.096 57.7478 15.081C58.6884 15.081 60.0768 15.1557 60.8084 15.2751C61.54 15.3796 62.5552 15.6334 63.0479 15.8275C63.5406 16.0366 64.3766 16.4397 64.9141 16.7383C65.4516 17.0369 66.5713 17.7833 67.4074 18.4104C68.2584 19.0375 69.632 20.2318 70.483 21.0679C71.319 21.9189 72.4686 23.173 73.036 23.8747C73.6033 24.5764 74.5439 25.8753 75.1411 26.7861C75.7532 27.6968 76.6042 29.13 77.067 29.996C77.5149 30.8619 78.1868 32.2952 78.5451 33.2059C78.9034 34.1166 79.4259 35.5797 79.6798 36.4905C79.9336 37.4012 80.2919 38.8643 80.4561 39.775C80.6801 40.8948 80.7995 42.3131 80.8443 44.254C80.904 45.9709 80.8592 47.6729 80.7547 48.5837C80.6651 49.4048 80.4113 50.8829 80.2172 51.8682C80.0082 52.8536 79.5305 54.5705 79.1572 55.6753C78.784 56.7802 78.0823 58.4971 77.6045 59.4825C77.1267 60.4678 76.4698 61.6622 75.589 63.0208L73.3495 60.8112C72.1103 59.587 69.3035 56.7802 67.0939 54.5556C64.8843 52.346 62.1222 49.5093 60.9726 48.2851C59.8081 47.0459 58.1658 45.2394 57.2999 44.254C56.434 43.2686 55.2844 41.8951 54.7469 41.1934C54.1945 40.4917 53.2838 39.2226 52.7164 38.3567C52.1491 37.4908 51.3877 36.2814 51.0293 35.6693C50.671 35.0572 50.0888 33.9375 49.7454 33.2059C49.402 32.4743 48.8794 31.1605 48.5808 30.2946C48.2822 29.4286 47.8941 28.07 47.7448 27.2638C47.5507 26.3382 47.4462 25.2184 47.4462 24.1285C47.4462 23.173 47.5507 22.0533 47.6701 21.5158C47.7896 21.0082 48.1031 20.1721 48.3569 19.6496C48.6256 19.127 49.2378 18.3208 49.7454 17.7983C50.4321 17.1115 50.9846 16.7383 51.9251 16.2904C52.6268 15.9619 53.657 15.5887 54.2393 15.4692Z"
        fill="currentColor"
      />
    </svg>
  )
}

export { ChromePillButton as HeaderPillButton }

export type AccountMenuUser = {
  name?: string | null
  email?: string | null
}

export function AccountMenu({
  user,
  onSignOut,
  onSignIn,
  onOpenSettings,
}: {
  user: AccountMenuUser | null
  onSignOut: () => Promise<void> | void
  onSignIn: () => void
  onOpenSettings?: () => void
}) {
  const menuItemClass =
    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label leading-4 text-foreground transition-colors hover:bg-foreground/6"

  return (
    <div className="flex items-center gap-2">
      <Popover
        side="bottom"
        align="start"
        trigger={
          <ChromePillButton ariaLabel="Open account menu">
            <QredenceLogo className="size-3.5 shrink-0" />
            <span className="text-[13px] font-medium tracking-[-0.01em] whitespace-nowrap">
              Fleet Prime Agent
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-foreground/35" />
          </ChromePillButton>
        }
      >
        {user ? (
          <>
            <div className="px-2 py-1.5 text-label leading-4 text-foreground/50">
              {user.name || user.email}
            </div>
            <button type="button" className={menuItemClass}>
              <QredenceLogo className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Account</span>
            </button>
            <a
              href={DOCUMENTATION_URL}
              target="_blank"
              rel="noreferrer"
              className={menuItemClass}
            >
              <BookOpenText className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Documentation</span>
            </a>
            {onOpenSettings && (
              <button
                type="button"
                className={menuItemClass}
                onClick={onOpenSettings}
              >
                <Settings className="size-3.5 shrink-0 text-foreground/50" />
                <span className="truncate">Settings</span>
              </button>
            )}
            <button
              type="button"
              className={menuItemClass}
              onClick={() => void onSignOut()}
            >
              <LogOut className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Sign out</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className={menuItemClass} onClick={onSignIn}>
              <LogIn className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Sign in</span>
            </button>
            <a
              href={DOCUMENTATION_URL}
              target="_blank"
              rel="noreferrer"
              className={menuItemClass}
            >
              <BookOpenText className="size-3.5 shrink-0 text-foreground/50" />
              <span className="truncate">Documentation</span>
            </a>
            {onOpenSettings && (
              <button
                type="button"
                className={menuItemClass}
                onClick={onOpenSettings}
              >
                <Settings className="size-3.5 shrink-0 text-foreground/50" />
                <span className="truncate">Settings</span>
              </button>
            )}
          </>
        )}
      </Popover>
    </div>
  )
}

export function SessionControls({
  activeSessionId,
  activeSessionLabel,
  onNewSession,
  onResumeSession,
  sessions,
}: {
  activeSessionId?: string
  activeSessionLabel: string
  onNewSession: () => void
  onResumeSession: (metadata: ChatSessionMetadata) => void
  sessions: Array<ChatSessionInfo>
}) {
  return (
    <>
      <Popover
        side="bottom"
        align="center"
        className="w-[min(360px,calc(100vw-2rem))]"
        overlay
        trigger={
          <ChromePillButton
            ariaLabel="Open conversations"
            className="w-28 justify-between sm:w-36 md:w-44 lg:w-52 xl:w-64"
          >
            <div className="flex min-w-0 items-center gap-2">
              <History className="size-3 shrink-0 text-foreground/35" />
              <span className="min-w-0 truncate text-left">
                {activeSessionLabel}
              </span>
            </div>
            <ChevronDown className="size-3.5 shrink-0 text-foreground/35" />
          </ChromePillButton>
        }
      >
        {sessions.length === 0 ? (
          <div className="px-2 py-2 text-label text-foreground/45">
            No saved conversations yet.
          </div>
        ) : (
          sessions.map((session) => {
            const label =
              session.name || session.firstMessage || session.id.slice(0, 8)
            const active = session.id === activeSessionId
            return (
              <button
                key={session.id}
                type="button"
                onClick={() =>
                  onResumeSession({
                    sessionFile: session.path,
                    sessionId: session.id,
                  })
                }
                className={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label leading-4 transition-colors hover:bg-foreground/6 ${
                  active ? "bg-foreground/6 text-foreground" : "text-foreground"
                }`}
              >
                <History className="size-3 shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            )
          })
        )}
      </Popover>
      <ChromePillButton ariaLabel="New session" onClick={onNewSession}>
        <Plus className="size-3.5 shrink-0" />
      </ChromePillButton>
    </>
  )
}
