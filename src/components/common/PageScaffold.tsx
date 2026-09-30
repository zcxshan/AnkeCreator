import { ReactNode } from 'react'
import { Icon } from './Icon'

export function PageHeader({
  title, onBack, actions,
}: { title: ReactNode; onBack?: () => void; actions?: ReactNode }) {
  return (
    <div className="anke-page-header">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} aria-label="返回" className="anke-btn">
            <Icon name="back" size={14} />
          </button>
        )}
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full flex-1 flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div className="w-full max-w-4xl mx-auto px-4 py-4 md:px-6 md:py-6 flex flex-col gap-4 flex-1">
        {children}
      </div>
    </div>
  )
}