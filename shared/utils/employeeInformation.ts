export const informationFields = [
 ['FirstName','First name','Personal details'],['MiddleName','Middle name','Personal details'],['LastName','Last name','Personal details'],['Nickname','Nickname','Personal details'],['Birthday','Birthday','Personal details'],['Gender','Gender','Personal details'],['CivilStatus','Civil status','Personal details'],
 ['Email','Email on employee record','Contact details'],['ContactNumber','Contact number on employee record','Contact details'],['PresentAddress','Present address','Contact details'],['PermanentAddress','Permanent address','Contact details'],
 ['EmployeeNumber','Employee number','Employment'],['AgencyName','Agency','Employment'],['PositionName','Position','Employment'],['DateHired','Date hired','Employment'],['Status','Employee status','Employment'],
 ['EmergencyName','Emergency contact name','Emergency contact'],['EmergencyRelationship','Relationship','Emergency contact'],['EmergencyContactNo','Emergency contact number','Emergency contact'],['EmergencyAddress','Emergency contact address','Emergency contact']
].map(([key,label,section])=>({key:key!,label:label!,section:section!}))
export const correctionFields=[...informationFields,{key:'Other',label:'Other information',section:'Other'}]
export const informationRequestStatuses=['Pending','In review','Resolved','Declined','Cancelled'] as const
