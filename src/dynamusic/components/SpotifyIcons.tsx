import React from "react";

type IconProps = { className?: string; style?: React.CSSProperties };

function Svg({ className = "w-4 h-4", style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={style} fill="currentColor" aria-hidden>
      {children}
    </svg>
  );
}

export function SpCoverNote({ className = "w-5 h-5", style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-hidden>
      <path d="M15 4v12.167a3.5 3.5 0 1 1-3.5-3.5H13V4zm-2 10.667h-1.5a1.5 1.5 0 1 0 1.5 1.5z" />
    </svg>
  );
}

export function SpShuffle({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z" />
      <path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z" />
    </Svg>
  );
}

export function SpPrev({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7z" />
    </Svg>
  );
}

export function SpPlay({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z" />
    </Svg>
  );
}

export function SpPause({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z" />
    </Svg>
  );
}

export function SpNext({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z" />
    </Svg>
  );
}

export function SpRepeat({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75z" />
    </Svg>
  );
}

export function SpRepeatOne({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h.75v1.5h-.75A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75zM12.25 2.5a2.25 2.25 0 0 1 2.25 2.25v5A2.25 2.25 0 0 1 12.25 12H9.81l1.018-1.018a.75.75 0 0 0-1.06-1.06L6.939 12.75l2.829 2.828a.75.75 0 1 0 1.06-1.06L9.811 13.5h2.439A3.75 3.75 0 0 0 16 9.75v-5A3.75 3.75 0 0 0 12.25 1h-.75v1.5z" />
      <path d="m8 1.85.77.694H6.095V1.488q1.046-.077 1.507-.385.474-.308.583-.913h1.32V8H8z" />
      <path d="M8.77 2.544 8 1.85v.693z" />
    </Svg>
  );
}

export function SpLyrics({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M13.426 2.574a2.831 2.831 0 0 0-4.797 1.55l3.247 3.247a2.831 2.831 0 0 0 1.55-4.797M10.5 8.118l-2.619-2.62L4.74 9.075 2.065 12.12a1.287 1.287 0 0 0 1.816 1.816l3.06-2.688 3.56-3.129zM7.12 4.094a4.331 4.331 0 1 1 4.786 4.786l-3.974 3.493-3.06 2.689a2.787 2.787 0 0 1-3.933-3.933l2.676-3.045z" />
    </Svg>
  );
}

export function SpQueue({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M15 15H1v-1.5h14zm0-4.5H1V9h14zm-14-7A2.5 2.5 0 0 1 3.5 1h9a2.5 2.5 0 0 1 0 5h-9A2.5 2.5 0 0 1 1 3.5m2.5-1a1 1 0 0 0 0 2h9a1 1 0 0 0 0-2z" />
    </Svg>
  );
}

export function SpMiniplayer({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M16 2.45v11.1h-16v-11.1h16zm-1.5 1.5h-13v8.1h13v-8.1zm-3 2.1v4.5h-5.5v-4.5h5.5z" />
    </Svg>
  );
}

export function SpFullscreen({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M6.53 10a.75.75 0 0 1 0 1.06l-2.72 2.72h2.44a.75.75 0 0 1 0 1.5H2.5A1.5 1.5 0 0 1 1 13.78v-3.75a.75.75 0 0 1 1.5 0v2.44l2.72-2.72A.75.75 0 0 1 6.53 10m2.94-4a.75.75 0 0 1 0-1.06L12.19 2.22H9.75a.75.75 0 0 1 0-1.5h3.75A1.5 1.5 0 0 1 15 2.22v3.75a.75.75 0 0 1-1.5 0V3.53l-2.72 2.72A.75.75 0 0 1 9.47 6" />
    </Svg>
  );
}

export function SpVolumeHigh({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4H0V4.85h2.066l6.925-4a.75.75 0 0 1 .75 0m-8.241 5.5v3.3h1.5l5.5 3.175V3.175L3 6.35zM11.5 4.5a.75.75 0 0 1 1.06 0 5 5 0 0 1 0 7.07.75.75 0 1 1-1.06-1.06 3.5 3.5 0 0 0 0-4.95.75.75 0 0 1 0-1.06m2.12-2.12a.75.75 0 0 1 1.06 0 8 8 0 0 1 0 11.31.75.75 0 0 1-1.06-1.06 6.5 6.5 0 0 0 0-9.19.75.75 0 0 1 0-1.06" />
    </Svg>
  );
}

export function SpVolumeOff({ className, style }: IconProps) {
  return (
    <Svg className={className} style={style}>
      <path d="M13.86 5.47a.75.75 0 0 0-1.061 1.06 3.5 3.5 0 0 1 0 4.95.75.75 0 0 0 1.06 1.06 5 5 0 0 0 0-7.07M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4H0V4.85h2.066l6.925-4a.75.75 0 0 1 .75 0m-8.241 5.5v3.3h1.5l5.5 3.175V3.175L3 6.35z" />
    </Svg>
  );
}

