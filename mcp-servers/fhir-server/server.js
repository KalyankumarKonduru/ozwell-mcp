import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

// FHIR Server Configuration - Simplified for public servers
const FHIR_BASE_URL = process.env.FHIR_BASE_URL || 'https://hapi.fhir.org/baseR4';

// Global FHIR client configuration - No authentication needed
let fhirHeaders = {
  'Accept': 'application/fhir+json',
  'Content-Type': 'application/fhir+json'
};

/**
 * Initialize FHIR connection and test capability
 */
async function initFhir() {
  try {
    console.error('🔗 Connecting to FHIR server...');
    console.error(`📍 FHIR Base URL: ${FHIR_BASE_URL}`);
    
    // Test connection with CapabilityStatement
    const response = await axios.get(`${FHIR_BASE_URL}/metadata`, {
      headers: fhirHeaders,
      timeout: 10000
    });
    
    const capability = response.data;
    console.error(`✅ Connected to FHIR server: ${capability.software?.name || 'Unknown'}`);
    console.error(`   FHIR Version: ${capability.fhirVersion}`);
    console.error(`   Implementation: ${capability.implementation?.description || 'Not specified'}`);
    console.error(`   Supported Resources: ${capability.rest?.[0]?.resource?.length || 0} resource types`);
    
    return true;
  } catch (error) {
    console.error('❌ FHIR connection failed:', error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${error.response.data?.issue?.[0]?.details?.text || error.response.statusText}`);
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to connect to FHIR server: ${error.message}`
    );
  }
}

/**
 * Create MCP Server instance
 */
const server = new Server(
  {
    name: 'fhir-ehr-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available FHIR tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_patients',
        description: 'Search for patients using FHIR Patient resource',
        inputSchema: {
          type: 'object',
          properties: {
            family: { type: 'string', description: 'Patient family name' },
            given: { type: 'string', description: 'Patient given name' },
            identifier: { type: 'string', description: 'Patient identifier (MRN, SSN, etc.)' },
            birthdate: { type: 'string', description: 'Patient birth date (YYYY-MM-DD)' },
            gender: { type: 'string', enum: ['male', 'female', 'other', 'unknown'], description: 'Patient gender' },
            phone: { type: 'string', description: 'Patient phone number' },
            email: { type: 'string', description: 'Patient email address' },
            address: { type: 'string', description: 'Patient address' },
            _count: { type: 'number', description: 'Maximum number of results', default: 20 },
            _sort: { type: 'string', description: 'Sort order', default: 'family' }
          }
        }
      },
      {
        name: 'get_patient',
        description: 'Get a specific patient by FHIR ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'FHIR Patient resource ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'get_patient_observations',
        description: 'Get observations (vital signs, lab results) for a patient',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: { type: 'string', description: 'FHIR Patient resource ID' },
            category: { 
              type: 'string', 
              enum: ['vital-signs', 'laboratory', 'imaging', 'survey', 'exam', 'therapy'],
              description: 'Observation category' 
            },
            code: { type: 'string', description: 'LOINC code for specific observation type' },
            date: { type: 'string', description: 'Date range (e.g., ge2024-01-01)' },
            _count: { type: 'number', description: 'Maximum number of results', default: 50 }
          },
          required: ['patient_id']
        }
      },
      {
        name: 'get_patient_conditions',
        description: 'Get medical conditions/diagnoses for a patient',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: { type: 'string', description: 'FHIR Patient resource ID' },
            clinical_status: { 
              type: 'string', 
              enum: ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'],
              description: 'Clinical status of condition' 
            },
            category: { type: 'string', description: 'Condition category' },
            code: { type: 'string', description: 'ICD-10 or SNOMED code' },
            _count: { type: 'number', description: 'Maximum number of results', default: 50 }
          },
          required: ['patient_id']
        }
      },
      {
        name: 'get_patient_medications',
        description: 'Get medications for a patient',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: { type: 'string', description: 'FHIR Patient resource ID' },
            status: { 
              type: 'string', 
              enum: ['active', 'completed', 'entered-in-error', 'intended', 'stopped', 'on-hold', 'unknown'],
              description: 'Medication status' 
            },
            category: { type: 'string', description: 'Medication category' },
            code: { type: 'string', description: 'RxNorm code for medication' },
            _count: { type: 'number', description: 'Maximum number of results', default: 50 }
          },
          required: ['patient_id']
        }
      },
      {
        name: 'get_patient_encounters',
        description: 'Get encounters/visits for a patient',
        inputSchema: {
          type: 'object',
          properties: {
            patient_id: { type: 'string', description: 'FHIR Patient resource ID' },
            status: { 
              type: 'string', 
              enum: ['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled'],
              description: 'Encounter status' 
            },
            class: { 
              type: 'string', 
              enum: ['AMB', 'EMER', 'FLD', 'HH', 'IMP', 'ACUTE', 'NONAC'],
              description: 'Encounter class (AMB=ambulatory, IMP=inpatient, etc.)' 
            },
            date: { type: 'string', description: 'Date range (e.g., ge2024-01-01)' },
            _count: { type: 'number', description: 'Maximum number of results', default: 50 }
          },
          required: ['patient_id']
        }
      },
      {
        name: 'search_observations',
        description: 'Search observations across all patients or by criteria',
        inputSchema: {
          type: 'object',
          properties: {
            patient: { type: 'string', description: 'Patient ID to filter by' },
            category: { 
              type: 'string', 
              enum: ['vital-signs', 'laboratory', 'imaging', 'survey', 'exam', 'therapy'],
              description: 'Observation category' 
            },
            code: { type: 'string', description: 'LOINC code for observation type' },
            value_quantity: { type: 'string', description: 'Numeric value range (e.g., gt100)' },
            date: { type: 'string', description: 'Date range (e.g., ge2024-01-01)' },
            _count: { type: 'number', description: 'Maximum number of results', default: 50 }
          }
        }
      },
      {
        name: 'get_fhir_capability',
        description: 'Get FHIR server capability statement',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'fhir_search',
        description: 'Generic FHIR resource search with custom parameters',
        inputSchema: {
          type: 'object',
          properties: {
            resource_type: { 
              type: 'string', 
              enum: ['Patient', 'Observation', 'Condition', 'MedicationRequest', 'Encounter', 'DiagnosticReport', 'Procedure', 'AllergyIntolerance'],
              description: 'FHIR resource type to search' 
            },
            search_params: { 
              type: 'object', 
              description: 'FHIR search parameters as key-value pairs' 
            }
          },
          required: ['resource_type']
        }
      },
      {
        name: 'create_patient',
        description: 'Create a new patient record (if server supports write operations)',
        inputSchema: {
          type: 'object',
          properties: {
            patient_resource: {
              type: 'object',
              description: 'Complete FHIR Patient resource object',
              properties: {
                resourceType: { type: 'string', enum: ['Patient'] },
                identifier: { type: 'array', description: 'Patient identifiers (MRN, etc.)' },
                name: { type: 'array', description: 'Patient names' },
                gender: { type: 'string', enum: ['male', 'female', 'other', 'unknown'] },
                birthDate: { type: 'string', description: 'Birth date (YYYY-MM-DD)' },
                telecom: { type: 'array', description: 'Contact information' },
                address: { type: 'array', description: 'Patient addresses' }
              },
              required: ['resourceType']
            }
          },
          required: ['patient_resource']
        }
      }
    ]
  };
});

/**
 * Handle tool execution requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    console.error(`📨 FHIR Tool Call: ${name}`, JSON.stringify(args, null, 2));
    
    let result;
    
    switch (name) {
      case 'search_patients':
        result = await searchPatients(args);
        break;
      case 'get_patient':
        result = await getPatient(args);
        break;
      case 'get_patient_observations':
        result = await getPatientObservations(args);
        break;
      case 'get_patient_conditions':
        result = await getPatientConditions(args);
        break;
      case 'get_patient_medications':
        result = await getPatientMedications(args);
        break;
      case 'get_patient_encounters':
        result = await getPatientEncounters(args);
        break;
      case 'search_observations':
        result = await searchObservations(args);
        break;
      case 'get_fhir_capability':
        result = await getFhirCapability();
        break;
      case 'fhir_search':
        result = await fhirSearch(args);
        break;
      case 'create_patient':
        result = await createPatient(args);
        break;
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
    
  } catch (error) {
    console.error(`❌ FHIR tool execution error (${name}):`, error);
    
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `FHIR tool execution failed: ${error.message}`
    );
  }
});

// ==================== FHIR OPERATIONS ====================

async function searchPatients(params) {
  try {
    const searchParams = new URLSearchParams();
    
    // Add search parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && key !== '_count' && key !== '_sort') {
        searchParams.append(key, value);
      }
    });
    
    // Add pagination and sorting
    if (params._count) searchParams.append('_count', params._count);
    if (params._sort) searchParams.append('_sort', params._sort);
    
    const url = `${FHIR_BASE_URL}/Patient?${searchParams.toString()}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const bundle = response.data;
    console.error(`🔍 Found ${bundle.total || bundle.entry?.length || 0} patients`);
    
    return {
      success: true,
      total: bundle.total,
      count: bundle.entry?.length || 0,
      patients: bundle.entry?.map(entry => ({
        id: entry.resource.id,
        fullUrl: entry.fullUrl,
        name: formatPatientName(entry.resource.name),
        gender: entry.resource.gender,
        birthDate: entry.resource.birthDate,
        identifiers: entry.resource.identifier?.map(id => ({
          system: id.system,
          value: id.value,
          type: id.type?.coding?.[0]?.display
        })),
        telecom: entry.resource.telecom?.map(t => ({
          system: t.system,
          value: t.value,
          use: t.use
        })),
        address: entry.resource.address?.map(a => ({
          use: a.use,
          line: a.line,
          city: a.city,
          state: a.state,
          postalCode: a.postalCode,
          country: a.country
        }))
      })) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Patient search failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function getPatient(params) {
  try {
    const { id } = params;
    const url = `${FHIR_BASE_URL}/Patient/${id}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const patient = response.data;
    console.error(`📄 Retrieved patient: ${formatPatientName(patient.name)}`);
    
    return {
      success: true,
      patient: {
        id: patient.id,
        resourceType: patient.resourceType,
        meta: patient.meta,
        name: formatPatientName(patient.name),
        gender: patient.gender,
        birthDate: patient.birthDate,
        identifiers: patient.identifier?.map(id => ({
          system: id.system,
          value: id.value,
          type: id.type?.coding?.[0]?.display
        })),
        telecom: patient.telecom,
        address: patient.address,
        maritalStatus: patient.maritalStatus,
        communication: patient.communication,
        generalPractitioner: patient.generalPractitioner,
        managingOrganization: patient.managingOrganization
      }
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return {
        success: false,
        error: 'Patient not found',
        id: params.id
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Get patient failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function getPatientObservations(params) {
  try {
    const { patient_id } = params;
    const searchParams = new URLSearchParams();
    searchParams.append('patient', patient_id);
    
    // Add optional parameters
    if (params.category) searchParams.append('category', params.category);
    if (params.code) searchParams.append('code', params.code);
    if (params.date) searchParams.append('date', params.date);
    if (params._count) searchParams.append('_count', params._count);
    searchParams.append('_sort', '-date'); // Most recent first
    
    const url = `${FHIR_BASE_URL}/Observation?${searchParams.toString()}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const bundle = response.data;
    console.error(`📊 Found ${bundle.entry?.length || 0} observations for patient ${patient_id}`);
    
    return {
      success: true,
      patient_id,
      total: bundle.total,
      count: bundle.entry?.length || 0,
      observations: bundle.entry?.map(entry => ({
        id: entry.resource.id,
        status: entry.resource.status,
        category: entry.resource.category?.map(cat => cat.coding?.[0]?.display).join(', '),
        code: {
          coding: entry.resource.code.coding?.[0],
          text: entry.resource.code.text
        },
        subject: entry.resource.subject.reference,
        effectiveDateTime: entry.resource.effectiveDateTime,
        valueQuantity: entry.resource.valueQuantity,
        valueString: entry.resource.valueString,
        valueCodeableConcept: entry.resource.valueCodeableConcept,
        component: entry.resource.component?.map(comp => ({
          code: comp.code.coding?.[0],
          valueQuantity: comp.valueQuantity,
          valueString: comp.valueString
        })),
        interpretation: entry.resource.interpretation?.map(i => i.coding?.[0]?.display).join(', '),
        referenceRange: entry.resource.referenceRange
      })) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Get patient observations failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function getPatientConditions(params) {
  try {
    const { patient_id } = params;
    const searchParams = new URLSearchParams();
    searchParams.append('patient', patient_id);
    
    if (params.clinical_status) searchParams.append('clinical-status', params.clinical_status);
    if (params.category) searchParams.append('category', params.category);
    if (params.code) searchParams.append('code', params.code);
    if (params._count) searchParams.append('_count', params._count);
    searchParams.append('_sort', '-onset-date');
    
    const url = `${FHIR_BASE_URL}/Condition?${searchParams.toString()}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const bundle = response.data;
    console.error(`🏥 Found ${bundle.entry?.length || 0} conditions for patient ${patient_id}`);
    
    return {
      success: true,
      patient_id,
      total: bundle.total,
      count: bundle.entry?.length || 0,
      conditions: bundle.entry?.map(entry => ({
        id: entry.resource.id,
        clinicalStatus: entry.resource.clinicalStatus?.coding?.[0]?.code,
        verificationStatus: entry.resource.verificationStatus?.coding?.[0]?.code,
        category: entry.resource.category?.map(cat => cat.coding?.[0]?.display).join(', '),
        severity: entry.resource.severity?.coding?.[0]?.display,
        code: {
          coding: entry.resource.code.coding?.[0],
          text: entry.resource.code.text
        },
        subject: entry.resource.subject.reference,
        onsetDateTime: entry.resource.onsetDateTime,
        onsetString: entry.resource.onsetString,
        abatementDateTime: entry.resource.abatementDateTime,
        recordedDate: entry.resource.recordedDate,
        recorder: entry.resource.recorder?.reference,
        asserter: entry.resource.asserter?.reference,
        note: entry.resource.note?.map(n => n.text).join('; ')
      })) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Get patient conditions failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function getPatientMedications(params) {
  try {
    const { patient_id } = params;
    const searchParams = new URLSearchParams();
    searchParams.append('patient', patient_id);
    
    if (params.status) searchParams.append('status', params.status);
    if (params.category) searchParams.append('category', params.category);
    if (params.code) searchParams.append('code', params.code);
    if (params._count) searchParams.append('_count', params._count);
    searchParams.append('_sort', '-authored-on');
    
    const url = `${FHIR_BASE_URL}/MedicationRequest?${searchParams.toString()}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const bundle = response.data;
    console.error(`💊 Found ${bundle.entry?.length || 0} medications for patient ${patient_id}`);
    
    return {
      success: true,
      patient_id,
      total: bundle.total,
      count: bundle.entry?.length || 0,
      medications: bundle.entry?.map(entry => ({
        id: entry.resource.id,
        status: entry.resource.status,
        intent: entry.resource.intent,
        category: entry.resource.category?.map(cat => cat.coding?.[0]?.display).join(', '),
        medication: entry.resource.medicationCodeableConcept ? {
          coding: entry.resource.medicationCodeableConcept.coding?.[0],
          text: entry.resource.medicationCodeableConcept.text
        } : entry.resource.medicationReference,
        subject: entry.resource.subject.reference,
        authoredOn: entry.resource.authoredOn,
        requester: entry.resource.requester?.reference,
        dosageInstruction: entry.resource.dosageInstruction?.map(d => ({
          text: d.text,
          timing: d.timing,
          route: d.route?.coding?.[0]?.display,
          doseAndRate: d.doseAndRate
        })),
        dispenseRequest: entry.resource.dispenseRequest,
        note: entry.resource.note?.map(n => n.text).join('; ')
      })) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Get patient medications failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function getPatientEncounters(params) {
  try {
    const { patient_id } = params;
    const searchParams = new URLSearchParams();
    searchParams.append('patient', patient_id);
    
    if (params.status) searchParams.append('status', params.status);
    if (params.class) searchParams.append('class', params.class);
    if (params.date) searchParams.append('date', params.date);
    if (params._count) searchParams.append('_count', params._count);
    searchParams.append('_sort', '-date');
    
    const url = `${FHIR_BASE_URL}/Encounter?${searchParams.toString()}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const bundle = response.data;
    console.error(`🏥 Found ${bundle.entry?.length || 0} encounters for patient ${patient_id}`);
    
    return {
      success: true,
      patient_id,
      total: bundle.total,
      count: bundle.entry?.length || 0,
      encounters: bundle.entry?.map(entry => ({
        id: entry.resource.id,
        status: entry.resource.status,
        class: entry.resource.class?.code,
        type: entry.resource.type?.map(t => t.coding?.[0]?.display).join(', '),
        subject: entry.resource.subject.reference,
        period: entry.resource.period,
        reasonCode: entry.resource.reasonCode?.map(r => r.coding?.[0]?.display).join(', '),
        reasonReference: entry.resource.reasonReference?.map(r => r.reference),
        participant: entry.resource.participant?.map(p => ({
          type: p.type?.map(t => t.coding?.[0]?.display).join(', '),
          individual: p.individual?.reference
        })),
        location: entry.resource.location?.map(l => ({
          location: l.location.reference,
          status: l.status
        })),
        serviceProvider: entry.resource.serviceProvider?.reference
      })) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Get patient encounters failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function searchObservations(params) {
  try {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && key !== '_count') {
        if (key === 'value_quantity') {
          searchParams.append('value-quantity', value);
        } else {
          searchParams.append(key, value);
        }
      }
    });
    
    if (params._count) searchParams.append('_count', params._count);
    searchParams.append('_sort', '-date');
    
    const url = `${FHIR_BASE_URL}/Observation?${searchParams.toString()}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const bundle = response.data;
    console.error(`📊 Found ${bundle.entry?.length || 0} observations`);
    
    return {
      success: true,
      total: bundle.total,
      count: bundle.entry?.length || 0,
      observations: bundle.entry?.map(entry => ({
        id: entry.resource.id,
        status: entry.resource.status,
        category: entry.resource.category?.map(cat => cat.coding?.[0]?.display).join(', '),
        code: {
          coding: entry.resource.code.coding?.[0],
          text: entry.resource.code.text
        },
        subject: entry.resource.subject.reference,
        effectiveDateTime: entry.resource.effectiveDateTime,
        valueQuantity: entry.resource.valueQuantity,
        valueString: entry.resource.valueString,
        interpretation: entry.resource.interpretation?.map(i => i.coding?.[0]?.display).join(', ')
      })) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Search observations failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function getFhirCapability() {
  try {
    const url = `${FHIR_BASE_URL}/metadata`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const capability = response.data;
    console.error(`📋 Retrieved FHIR capability statement`);
    
    return {
      success: true,
      fhirVersion: capability.fhirVersion,
      software: capability.software,
      implementation: capability.implementation,
      format: capability.format,
      supportedResources: capability.rest?.[0]?.resource?.map(r => ({
        type: r.type,
        interaction: r.interaction?.map(i => i.code),
        searchParam: r.searchParam?.map(sp => ({
          name: sp.name,
          type: sp.type,
          documentation: sp.documentation
        }))
      })) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Get FHIR capability failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function fhirSearch(params) {
  try {
    const { resource_type, search_params = {} } = params;
    const searchParamsString = new URLSearchParams(search_params).toString();
    
    const url = `${FHIR_BASE_URL}/${resource_type}${searchParamsString ? '?' + searchParamsString : ''}`;
    const response = await axios.get(url, { headers: fhirHeaders });
    
    const bundle = response.data;
    console.error(`🔍 Generic search for ${resource_type}: found ${bundle.entry?.length || 0} results`);
    
    return {
      success: true,
      resource_type,
      search_params,
      total: bundle.total,
      count: bundle.entry?.length || 0,
      results: bundle.entry?.map(entry => entry.resource) || []
    };
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `FHIR search failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

async function createPatient(params) {
  try {
    const { patient_resource } = params;
    
    // Validate the resource
    if (patient_resource.resourceType !== 'Patient') {
      throw new Error('Resource must be of type Patient');
    }
    
    const url = `${FHIR_BASE_URL}/Patient`;
    const response = await axios.post(url, patient_resource, { headers: fhirHeaders });
    
    const createdPatient = response.data;
    console.error(`👤 Created patient: ${formatPatientName(createdPatient.name)} (ID: ${createdPatient.id})`);
    
    return {
      success: true,
      operation: 'create',
      patient: {
        id: createdPatient.id,
        name: formatPatientName(createdPatient.name),
        location: response.headers.location
      }
    };
  } catch (error) {
    if (error.response?.status === 405) {
      return {
        success: false,
        error: 'FHIR server does not support create operations',
        note: 'This is a read-only FHIR server'
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Create patient failed: ${error.response?.data?.issue?.[0]?.details?.text || error.message}`
    );
  }
}

// ==================== HELPER FUNCTIONS ====================

function formatPatientName(names) {
  if (!names || !Array.isArray(names) || names.length === 0) {
    return 'Unknown Patient';
  }
  
  const name = names[0];
  const given = name.given ? name.given.join(' ') : '';
  const family = name.family || '';
  
  return `${given} ${family}`.trim() || 'Unknown Patient';
}

// ==================== SERVER STARTUP ====================

/**
 * Start the FHIR MCP server
 */
async function startServer() {
  try {
    // Initialize FHIR connection
    await initFhir();
    
    console.error('🚀 FHIR EHR MCP Server started');
    console.error('📋 Available tools: search_patients, get_patient, get_patient_observations, get_patient_conditions, get_patient_medications, get_patient_encounters, search_observations, get_fhir_capability, fhir_search, create_patient');
    console.error('🔌 Listening on stdio for MCP protocol communication');
    
    // Create transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
  } catch (error) {
    console.error('❌ Failed to start FHIR MCP Server:', error);
    process.exit(1);
  }
}

// ==================== GRACEFUL SHUTDOWN ====================

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  console.error(`🛑 Received ${signal}. Shutting down FHIR MCP Server...`);
  
  try {
    console.error('✅ FHIR MCP Server shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// ==================== START THE SERVER ====================

startServer().catch((error) => {
  console.error('❌ Fatal error starting FHIR MCP Server:', error);
  process.exit(1);
});