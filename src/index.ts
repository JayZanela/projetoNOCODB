#!/usr/bin/env node

/**
 * NocoDB MCP Server
 * 
 * This MCP server integrates with NocoDB to provide database capabilities.
 * It allows:
 * - Listing databases and tables as resources
 * - Creating and managing tables
 * - Adding, updating, and querying records
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Carregar variáveis de ambiente do arquivo .env
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.error(`Carregando variáveis de ambiente do arquivo: ${envPath}`);
  dotenv.config({ path: envPath });
} else {
  console.error(`Arquivo .env não encontrado em: ${envPath}`);
  console.error('Usando variáveis de ambiente do sistema ou valores padrão');
  dotenv.config();
}

// NocoDB configuration - Lendo do arquivo .env
const NOCODB_URL = process.env.NOCODB_URL || "http://localhost:8080";
const NOCODB_AUTH_TOKEN = process.env.NOCODB_AUTH_TOKEN;
const NOCODB_BASE_ID = process.env.NOCODB_BASE_ID;
const API_VERSION = process.env.API_VERSION || "v2";

// Log de configuração
console.error("Configuração do servidor NocoDB MCP:");
console.error(`URL: ${NOCODB_URL}`);
console.error(`Base ID: ${NOCODB_BASE_ID}`);
console.error(`API Version: ${API_VERSION}`);
console.error(`Token: ${NOCODB_AUTH_TOKEN ? "Configurado" : "Não configurado"}`);

/**
 * NocoDB MCP Server class
 */
export class NocoDBServer {

  
      /**
       * Executa comandos do NocoDB
       */
      async executeCommand(comando: any): Promise<any> {
          try {
              switch (comando.action) {
                  case 'list_projects':
                      return await this.listProjects();
                  
                  case 'list_tables':
                      return await this.listTables(comando.params);
                  
                  case 'query_table':
                      return await this.queryTable(comando.params);
                  
                  case 'insert_record':
                      return await this.insertRecord(comando.params);
                  
                  case 'update_record':
                      return await this.updateRecord(comando.params);
                  
                  case 'delete_record':
                      return await this.deleteRecord(comando.params);
                  
                  case 'query_table_by_name':
                      return await this.queryTableByName(comando.params);
                  
                  default:
                      throw new Error(`Comando desconhecido: ${comando.action}`);
              }
          } catch (error: any) {
              console.error('Erro ao executar comando:', error);
              throw error;
          }
      }

  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: "nocodb-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Create axios instance for NocoDB API
    this.axiosInstance = axios.create({
      baseURL: NOCODB_URL,
      headers: {
        'xc-token': NOCODB_AUTH_TOKEN,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Log connection attempt
    console.error(`Attempting to connect to NocoDB at ${NOCODB_URL} with token: ${NOCODB_AUTH_TOKEN ? 'Provided' : 'Not provided'}`);
    console.error(`Using base ID: ${NOCODB_BASE_ID}`);
    console.error(`Using API version: ${API_VERSION}`);

    // Set up handlers
    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Set up resource handlers for NocoDB
   */
  private setupResourceHandlers() {
    // List available resources (databases and tables)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        // Get list of projects (databases)
        const projectsResponse = await this.axiosInstance.get('/api/v1/db/meta/projects');
        const projects = projectsResponse.data.list || [];
        
        const resources = [];
        
        // Add each project as a resource
        for (const project of projects) {
          resources.push({
            uri: `nocodb://project/${project.id}`,
            mimeType: "application/json",
            name: project.title,
            description: `NocoDB project: ${project.title}`
          });
          
          // Get tables for this project
          try {
            const tablesResponse = await this.axiosInstance.get(`/api/v1/db/meta/projects/${project.id}/tables`);
            const tables = tablesResponse.data.list || [];
            
            // Add each table as a resource
            for (const table of tables) {
              resources.push({
                uri: `nocodb://table/${project.id}/${table.id}`,
                mimeType: "application/json",
                name: table.title,
                description: `Table ${table.title} in project ${project.title}`
              });
            }
          } catch (error: any) {
            console.error(`Erro Não conhecido ao buscar Tabelas do projeto ${project.id}:`, error);
          }
        }
        
        return { resources };
      } catch (error: any) {
        console.error("Erro Não conhecido ao listar recursos:", error);
        return { resources: [] };
      }
    });

    // Read resource content (project or table data)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      // Parse URI to determine what to fetch
      if (uri.startsWith("nocodb://project/")) {
        // Fetch project details
        const projectId = uri.replace("nocodb://project/", "");
        try {
          const projectResponse = await this.axiosInstance.get(`/api/v1/db/meta/projects/${projectId}`);
          const tablesResponse = await this.axiosInstance.get(`/api/v1/db/meta/projects/${projectId}/tables`);
          
          const projectData = {
            ...projectResponse.data,
            tables: tablesResponse.data.list || []
          };
          
          return {
            contents: [{
              uri: uri,
              mimeType: "application/json",
              text: JSON.stringify(projectData, null, 2)
            }]
          };
        } catch (error: any) {
          throw new McpError(ErrorCode.InternalError, `Erro Não conhecido ao buscar projeto: ${error.message}`);
        }
      } else if (uri.startsWith("nocodb://table/")) {
        // Fetch table data
        const parts = uri.replace("nocodb://table/", "").split("/");
        const projectId = parts[0];
        const tableId = parts[1];
        
        try {
          // Get table metadata
          const tableResponse = await this.axiosInstance.get(`/api/v1/db/meta/tables/${tableId}`);
          
          // Get table records
          const recordsResponse = await this.axiosInstance.get(`/api/v1/db/data/noco/${projectId}/${tableResponse.data.title}`);
          
          return {
            contents: [{
              uri: uri,
              mimeType: "application/json",
              text: JSON.stringify({
                metadata: tableResponse.data,
                records: recordsResponse.data.list || []
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new McpError(ErrorCode.InternalError, `Erro ao buscar dados da tabela: ${error.message}`);
        }
      } else {
        throw new McpError(ErrorCode.InvalidRequest, `Formato de URI inválido: ${uri}`);
      }
    });
  }

  /**
   * Set up tool handlers for NocoDB operations
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_projects",
          description: "List all NocoDB projects (databases)",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "create_project",
          description: "Create a new NocoDB project (database)",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Project title"
              },
              description: {
                type: "string",
                description: "Project description (optional)"
              }
            },
            required: ["title"]
          }
        },
        {
          name: "list_tables",
          description: "List all tables in a NocoDB project",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID"
              }
            },
            required: ["projectId"]
          }
        },
        {
          name: "create_table",
          description: "Create a new table in a NocoDB project",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID"
              },
              tableName: {
                type: "string",
                description: "Table name"
              },
              columns: {
                type: "array",
                description: "Column definitions",
                items: {
                  type: "object",
                  properties: {
                    column_name: {
                      type: "string",
                      description: "Column name"
                    },
                    column_type: {
                      type: "string",
                      description: "Column type (e.g., 'SingleLineText', 'Number', 'Date', etc.)"
                    },
                    is_primary: {
                      type: "boolean",
                      description: "Whether this column is the primary key"
                    }
                  },
                  required: ["column_name", "column_type"]
                }
              }
            },
            required: ["projectId", "tableName", "columns"]
          }
        },
        {
          name: "query_table",
          description: "Query records from a table",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID"
              },
              tableName: {
                type: "string",
                description: "Table name"
              },
              filters: {
                type: "object",
                description: "Filter conditions (optional)"
              },
              limit: {
                type: "number",
                description: "Maximum number of records to return (optional)"
              },
              offset: {
                type: "number",
                description: "Number of records to skip (optional)"
              }
            },
            required: ["projectId", "tableName"]
          }
        },
        {
          name: "insert_record",
          description: "Insert a new record into a table",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID"
              },
              tableName: {
                type: "string",
                description: "Table name"
              },
              data: {
                type: "object",
                description: "Record data (column name -> value)"
              }
            },
            required: ["projectId", "tableName", "data"]
          }
        },
        {
          name: "update_record",
          description: "Update an existing record in a table",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID"
              },
              tableName: {
                type: "string",
                description: "Table name"
              },
              recordId: {
                type: "string",
                description: "Record ID to update"
              },
              data: {
                type: "object",
                description: "Updated record data (column name -> value)"
              }
            },
            required: ["projectId", "tableName", "recordId", "data"]
          }
        },
        {
          name: "delete_record",
          description: "Delete a record from a table",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "Project ID"
              },
              tableName: {
                type: "string",
                description: "Table name"
              },
              recordId: {
                type: "string",
                description: "Record ID to delete"
              }
            },
            required: ["projectId", "tableName", "recordId"]
          }
        },
        {
          name: "query_table_by_name",
          description: "Query records from a table by table name directly",
          inputSchema: {
            type: "object",
            properties: {
              tableName: {
                type: "string",
                description: "Table name (e.g., m1thx9m7x7e5nds)"
              },
              limit: {
                type: "number",
                description: "Maximum number of records to return (optional)"
              }
            },
            required: ["tableName"]
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments || {};

      try {
        switch (toolName) {
          case "list_projects":
            return await this.listProjects();
          
          case "create_project":
            return await this.createProject(args);
          
          case "list_tables":
            return await this.listTables(args);
          
          case "create_table":
            return await this.createTable(args);
          
          case "query_table":
            return await this.queryTable(args);
          
          case "insert_record":
            return await this.insertRecord(args);
          
          case "update_record":
            return await this.updateRecord(args);
          
          case "delete_record":
            return await this.deleteRecord(args);
          
          case "query_table_by_name":
            return await this.queryTableByName(args);
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
        }
      } catch (error: any) {
        console.error(`Error executing tool ${toolName}:`, error);
        
        if (error instanceof McpError) {
          throw error;
        }
        
        return {
          content: [{
            type: "text",
            text: `Error: ${error.message}`
          }],
          isError: true
        };
      }
    });
  }

  /**
   * List all NocoDB projects
   */
  private async listProjects() {
    try {
      const response = await this.axiosInstance.get('/api/v1/db/meta/projects');
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.data, null, 2)
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list projects: ${error.message}`);
    }
  }

  /**
   * Create a new NocoDB project
   */
  private async createProject(args: any) {
    const { title, description = "" } = args;
    
    try {
      const response = await this.axiosInstance.post('/api/v1/db/meta/projects', {
        title,
        description
      });
      
      return {
        content: [{
          type: "text",
          text: `Project created successfully: ${JSON.stringify(response.data, null, 2)}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to create project: ${error.message}`);
    }
  }

  /**
   * List all tables in a project
   */
  private async listTables(args: any) {
    const { projectId } = args;
    
    try {
      const response = await this.axiosInstance.get(`/api/v1/db/meta/projects/${projectId}/tables`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.data, null, 2)
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list tables: ${error.message}`);
    }
  }

  /**
   * Create a new table in a project
   */
  private async createTable(args: any) {
    const { projectId, tableName, columns } = args;
    
    try {
      // Create table
      const createTableResponse = await this.axiosInstance.post(`/api/v1/db/meta/projects/${projectId}/tables`, {
        table_name: tableName
      });
      
      const tableId = createTableResponse.data.id;
      
      // Add columns
      for (const column of columns) {
        await this.axiosInstance.post(`/api/v1/db/meta/tables/${tableId}/columns`, {
          column_name: column.column_name,
          title: column.column_name,
          uidt: column.column_type,
          ...(column.is_primary ? { pk: true } : {})
        });
      }
      
      return {
        content: [{
          type: "text",
          text: `Table '${tableName}' created successfully with ${columns.length} columns.`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to create table: ${error.message}`);
    }
  }

  /**
   * Query records from a table
   */
  private async queryTable(args: any) {
    const { projectId, tableName, filters = {}, limit = 100, offset = 0 } = args;
    
    try {
      // Build query parameters
      const queryParams: any = {
        limit,
        offset
      };
      
      // Add filters if provided
      if (Object.keys(filters).length > 0) {
        queryParams.where = JSON.stringify(filters);
      }
      
      const response = await this.axiosInstance.get(
        `/api/v1/db/data/noco/${projectId}/${tableName}`,
        { params: queryParams }
      );
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.data, null, 2)
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to query table: ${error.message}`);
    }
  }

  /**
   * Insert a new record into a table
   */
  private async insertRecord(args: any) {
    const { projectId, tableName, data } = args;
    
    try {
      const response = await this.axiosInstance.post(
        `/api/v1/db/data/noco/${projectId}/${tableName}`,
        data
      );
      
      return {
        content: [{
          type: "text",
          text: `Record inserted successfully: ${JSON.stringify(response.data, null, 2)}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to insert record: ${error.message}`);
    }
  }

  /**
   * Update an existing record in a table
   */
  private async updateRecord(args: any) {
    const { projectId, tableName, recordId, data } = args;
    
    try {
      const response = await this.axiosInstance.patch(
        `/api/v1/db/data/noco/${projectId}/${tableName}/${recordId}`,
        data
      );
      
      return {
        content: [{
          type: "text",
          text: `Record updated successfully: ${JSON.stringify(response.data, null, 2)}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to update record: ${error.message}`);
    }
  }

  /**
   * Delete a record from a table
   */
  private async deleteRecord(args: any) {
    const { projectId, tableName, recordId } = args;
    
    try {
      await this.axiosInstance.delete(
        `/api/v1/db/data/noco/${projectId}/${tableName}/${recordId}`
      );
      
      return {
        content: [{
          type: "text",
          text: `Record deleted successfully.`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to delete record: ${error.message}`);
    }
  }

  /**
   * Query a table directly by name without needing to know the project ID
   */
  private async queryTableByName(args: any) {
    const { tableName, limit = 100 } = args;
    
    try {
      console.error(`Attempting to query table by name: ${tableName}`);
      
      // Using NocoDB v2 API with the base ID
      const response = await this.axiosInstance.get(
        `/api/${API_VERSION}/tables/${tableName}/records`,
        { 
          params: { 
            limit,
            baseId: NOCODB_BASE_ID
          }
        }
      );
      
      console.error(`Response received: ${JSON.stringify(response.data)}`);
      
      // Extract count information from the response
      const recordCount = response.data.list ? response.data.list.length : 0;
      const totalCount = response.data.pageInfo ? response.data.pageInfo.totalRows : recordCount;
      
      return {
        content: [{
          type: "text",
          text: `Table ${tableName} contains ${totalCount} total records. Retrieved ${recordCount} records.`
        }]
      };
    } catch (error: any) {
      console.error(`Error querying table by name: ${error.message}`);
      console.error(`Error details: ${JSON.stringify(error.response?.data || {})}`);
      
      // Try an alternative approach - using a different endpoint format
      try {
        console.error("Trying alternative approach - using different endpoint format");
        
        const response = await this.axiosInstance.get(
          `/api/${API_VERSION}/bases/${NOCODB_BASE_ID}/tables/${tableName}/records`,
          { 
            params: { limit }
          }
        );
        
        console.error(`Alternative approach response: ${JSON.stringify(response.data)}`);
        
        const recordCount = response.data.list ? response.data.list.length : 0;
        const totalCount = response.data.pageInfo ? response.data.pageInfo.totalRows : recordCount;
        
        return {
          content: [{
            type: "text",
            text: `Table ${tableName} contains ${totalCount} total records. Retrieved ${recordCount} records.`
          }]
        };
      } catch (alternativeError: any) {
        console.error(`Alternative approach error: ${alternativeError.message}`);
        console.error(`Alternative error details: ${JSON.stringify(alternativeError.response?.data || {})}`);
        
        throw new Error(`Failed to query table by name: ${error.message}. Alternative approach also failed: ${alternativeError.message}`);
      }
    }
  }

  /**
   * Start the server
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('NocoDB MCP server running on stdio');
  }
}

// Create and run the server
const server = new NocoDBServer();
server.run().catch(console.error);
