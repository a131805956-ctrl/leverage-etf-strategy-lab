import './styles/tokens.css';
import './styles/app.css';
import { StrategyLabApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('找不到應用程式掛載點');

const app = new StrategyLabApp(root);
void app.start();
