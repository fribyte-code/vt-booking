import { IS_DEMO } from '../config'
import { createApiDataSource } from './apiDataSource'
import type { DataSource } from './dataSource'
import { createDemoDataSource } from './demoDataSource'

/** The app's single data source, chosen at build time. */
export const dataSource: DataSource = IS_DEMO ? createDemoDataSource() : createApiDataSource()
