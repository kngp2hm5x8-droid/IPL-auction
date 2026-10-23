import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <EmptyState icon={<Compass className="size-5" />} title="Page not found" action={<Link to="/"><Button variant="primary">Back home</Button></Link>}>
        That page does not exist.
      </EmptyState>
    </div>
  );
}
