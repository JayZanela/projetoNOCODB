//import OpenAI from 'openai';
//import { NocoDBServer } from './index.js';
//import dotenv from 'dotenv';
//
//dotenv.config();
//
//export class GPTNocoDBClient {
//    private openai: OpenAI;
//    private nocodb: NocoDBServer;
//
//    constructor() {
//        this.openai = new OpenAI({
//            apiKey: process.env.OPENAI_API_KEY
//        });
//
//        this.nocodb = new NocoDBServer();
//    }
//
//    async processNaturalQuery(question: string): Promise<any> {
//        try {
//            // 1. Converter pergunta em comando via GPT
//            const completion = await this.openai.chat.completions.create({
//                messages: [
//                    {
//                        role: "system",
//                        content: `Você é um assistente que converte perguntas em linguagem natural para comandos NocoDB.
//                                Comandos disponíveis: list_projects, list_tables, query_table, insert_record, update_record, delete_record.`
//                    },
//                    {
//                        role: "user",
//                        content: question
//                    }
//                ],
//                model: "gpt-3.5-turbo"
//            });
//            const messageContent = completion.choices[0].message.content;
//                if (!messageContent) {
//                    throw new Error("Resposta vazia do OpenAI");
//                }
//
//            const comando = JSON.parse(messageContent);
//            console.log("Comando interpretado:", comando);
//
//            // 2. Executar comando no NocoDB
//            return await this.nocodb.executeCommand(comando);
//
//        } catch (error) {
//            console.error("Erro ao processar pergunta:", error);
//            throw error;
//        }
//    }
//