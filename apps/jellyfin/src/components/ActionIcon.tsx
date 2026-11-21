const paths = {
  restart: 'M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7',
  trailer: 'M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m0 2v3h3V5H4m5 0v3h6V5H9m8 0v3h3V5h-3M9 11v7l6-3.5L9 11',
  watched: 'm9 16.2-4.2-4.2L3.4 13.4 9 19 21 7l-1.4-1.4L9 16.2',
  favorite: 'M12 21 3.5 12.5A5.5 5.5 0 0 1 12 5.6a5.5 5.5 0 0 1 8.5 6.9L12 21m0-2.8 7.1-7.1a3.5 3.5 0 0 0-5-4.9L12 8.3l-2.1-2.1a3.5 3.5 0 0 0-5 4.9l7.1 7.1',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
}

export function ActionIcon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d={paths[name]} /></svg>
}
