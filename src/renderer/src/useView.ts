import { useEffect, useState } from 'react';
import type { AppView } from '../../core/view';
import { tidy } from './api';

/** The latest AppView from main. Main pushes a new one after every change, so the UI never computes tax itself. */
export function useView(): AppView | null {
  const [view, setView] = useState<AppView | null>(null);
  useEffect(() => {
    let live = true;
    const off = tidy().onView((v) => setView(v));
    void tidy()
      .getView()
      .then((v) => {
        if (live) setView((current) => current ?? v);
      });
    return () => {
      live = false;
      off();
    };
  }, []);
  return view;
}
