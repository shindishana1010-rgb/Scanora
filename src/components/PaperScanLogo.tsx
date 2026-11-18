import React from 'react';

interface PaperScanLogoProps {
  size?: number;
  className?: string;
}

export const PaperScanLogo: React.FC<PaperScanLogoProps> = ({
  size = 36,
  className = '',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="11" fill="#173B65" />
      {/* Document body */}
      <path
        d="M12.5 9.5H23.2L28.5 14.8V29.5C28.5 30.6046 27.6046 31.5 26.5 31.5H12.5C11.3954 31.5 10.5 30.6046 10.5 29.5V11.5C10.5 10.3954 11.3954 9.5 12.5 9.5Z"
        fill="#FFFFFF"
      />
      {/* Folded corner */}
      <path d="M23.2 9.5V14.8H28.5L23.2 9.5Z" fill="#EAF3FC" />
      {/* Document text lines */}
      <rect x="13.5" y="16" width="8.5" height="2" rx="1" fill="#B9D2EC" />
      <rect x="13.5" y="25" width="11" height="2" rx="1" fill="#B9D2EC" />
      {/* Crisp active scan beam */}
      <rect x="8.5" y="20.25" width="23" height="2.5" rx="1.25" fill="#173B65" />
      <rect x="9.5" y="20.75" width="21" height="1.5" rx="0.75" fill="#6AA8E8" />
    </svg>
  );
};
