import { useEffect, useRef } from 'react'

export interface TagSuggestionsProps {
  anchor: HTMLElement
  items: string[]
  highlight: number
  onHighlight: (i: number) => void
  existing: string[]
  onPick: (tag: string) => void
  query: string
  allTags: string[]
  onContainerChange?: (el: HTMLDivElement | null) => void
}

export function TagSuggestions({
  anchor,
  items,
  highlight,
  onHighlight,
  existing,
  onPick,
  query,
  allTags,
  onContainerChange,
}: TagSuggestionsProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    onContainerChange?.(ref.current)
    return () => onContainerChange?.(null)
  }, [onContainerChange])

  useEffect(() => {
    function place() {
      if (!ref.current) return
      const r = anchor.getBoundingClientRect()
      ref.current.style.position = 'fixed'
      ref.current.style.top = `${r.bottom}px`
      ref.current.style.left = `${r.left}px`
      ref.current.style.minWidth = `${r.width}px`
    }

    place()
    const obs = new ResizeObserver(place)
    obs.observe(anchor)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)

    return () => {
      obs.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  return (
    <div
      ref={ref}
      data-tag-scroll
      role="listbox"
      className="z-[1000] pointer-events-auto max-h-52 w-56 overflow-auto rounded-md border bg-popover p-1 shadow-lg focus:outline-none thin-scrollbar scroll-smooth"
      onWheel={(e) => {
        if (!ref.current) return
        e.preventDefault()
        ref.current.scrollTop += e.deltaY / 2
      }}
    >
      {items.map((t, i) => (
        <div
          key={t}
          data-idx={i}
          role="option"
          aria-selected={i === highlight}
          className={`cursor-pointer select-none rounded-sm px-2 py-1 text-[11px] flex items-center justify-between ${i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`}
          onMouseEnter={() => onHighlight(i)}
          onPointerDown={(e) => {
            e.preventDefault()
            onPick(t)
          }}
        >
          <span>{t}</span>
          {existing.includes(t) && (
            <span className="text-[9px] opacity-60 ml-2">added</span>
          )}
        </div>
      ))}
      {query && !allTags.includes(query) && (
        <div className="mt-1 border-t pt-1 text-[10px] px-1 text-muted-foreground">
          Enter to create "{query}"
        </div>
      )}
    </div>
  )
}
