import { Text } from 'react-native';
import LegacyDiagnostics from '../../App';
import { useGame } from '../game-context';
import { Page, ui } from '../ui';
export default function Diagnostics() {
  const g = useGame();
  if (!g.loaded || g.session) return <Page><Text style={ui.body}>Finish or leave your event before running standalone GPS diagnostics.</Text></Page>;
  return <LegacyDiagnostics />;
}
