import { createApiDataSource } from './apiDataSource'
import type { DataSource } from './dataSource'

/** The app's single data source. */
export const dataSource: DataSource = createApiDataSource()
