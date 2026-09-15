/**
 * A simple test component with a Tailwind color to verify the UI library setup
 */
export function TestComponent() {
  return (
    <div className="bg-blue-500 text-white p-4 rounded-lg">
      <p className="font-semibold">UI Library Test Component</p>
      <p className="text-sm mt-2">
        This component uses Tailwind classes (bg-blue-500) to verify the setup works correctly.
      </p>
    </div>
  );
}
